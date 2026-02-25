import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submission_id, repo_url, assignment_id } = await req.json();

    if (!submission_id || !repo_url || !assignment_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: submission_id, repo_url, assignment_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Mark submission as reviewing
    await supabase
      .from("submissions")
      .update({ status: "reviewing" })
      .eq("id", submission_id);

    // 1. Fetch rubric from assignment
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("rubric_text, title")
      .eq("id", assignment_id)
      .single();

    if (assignmentError || !assignment) {
      await supabase.from("submissions").update({ status: "error", feedback: "Assignment not found" }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "Assignment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Extract code from GitHub repo
    const urlMatch = repo_url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
    if (!urlMatch) {
      await supabase.from("submissions").update({ status: "error", feedback: "Invalid GitHub URL" }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "Invalid GitHub URL format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [, owner, repo] = urlMatch;
    const cleanRepo = repo.replace(/\.git$/, "");

    // Use cache-busting timestamp to avoid stale GitHub API responses
    const cacheBuster = `_cb=${Date.now()}`;
    const githubHeaders: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "CodeReview-LMS",
      "If-None-Match": "", // Force bypass GitHub conditional caching
    };

    let codeContent = "";
    let fileCount = 0;
    try {
      // First get the default branch
      const repoInfoResp = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepo}?${cacheBuster}`,
        { headers: githubHeaders }
      );

      let defaultBranch = "main";
      if (repoInfoResp.ok) {
        const repoInfo = await repoInfoResp.json();
        defaultBranch = repoInfo.default_branch || "main";
        console.log(`Repo default branch: ${defaultBranch}`);
      } else {
        const repoErrText = await repoInfoResp.text();
        console.log(`Could not fetch repo info (${repoInfoResp.status}): ${repoErrText}`);
      }

      // Fetch tree using the actual default branch
      const treeResp = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepo}/git/trees/${defaultBranch}?recursive=1&${cacheBuster}`,
        { headers: githubHeaders }
      );

      if (!treeResp.ok) {
        const errText = await treeResp.text();
        throw new Error(`Could not access repository tree (${treeResp.status}): ${errText}. Ensure the repo is public.`);
      }

      const treeData = await treeResp.json();

      const codeExtensions = [".js", ".ts", ".tsx", ".jsx", ".py", ".java", ".css", ".html", ".json", ".md", ".rb", ".go", ".rs", ".c", ".cpp", ".h", ".php", ".sh", ".yaml", ".yml"];
      const codeFiles = (treeData.tree || [])
        .filter((f: any) => f.type === "blob" && codeExtensions.some((ext) => f.path.endsWith(ext)))
        .filter((f: any) => !f.path.includes("node_modules") && !f.path.includes(".lock") && !f.path.includes("dist/") && !f.path.includes("__pycache__"))
        .slice(0, 20);

      console.log(`Found ${codeFiles.length} code files in repo: ${codeFiles.map((f: any) => f.path).join(", ")}`);

      if (codeFiles.length === 0) {
        // Log the full tree for debugging
        const allFiles = (treeData.tree || []).map((f: any) => f.path);
        console.log(`No code files matched. All files in repo: ${allFiles.join(", ")}`);
      }

      for (const file of codeFiles) {
        try {
          // Use raw content endpoint with cache busting
          const fileResp = await fetch(
            `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${defaultBranch}/${file.path}?${cacheBuster}`,
            { headers: { "User-Agent": "CodeReview-LMS", "Cache-Control": "no-cache" } }
          );
          if (fileResp.ok) {
            const content = await fileResp.text();
            const trimmed = content.length > 3000 ? content.substring(0, 3000) + "\n... (truncated)" : content;
            codeContent += `\n--- FILE: ${file.path} ---\n${trimmed}\n`;
            fileCount++;
          } else {
            console.log(`Failed to fetch file ${file.path}: ${fileResp.status}`);
            await fileResp.text(); // consume body
          }
        } catch (fileErr) {
          console.log(`Error fetching file ${file.path}: ${fileErr}`);
        }

        if (codeContent.length > 30000) break;
      }
    } catch (err: any) {
      console.error("GitHub fetch error:", err.message);
      await supabase.from("submissions").update({ status: "error", feedback: "Failed to fetch code: " + err.message }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "Failed to fetch code from GitHub: " + err.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!codeContent.trim()) {
      await supabase.from("submissions").update({ status: "error", feedback: "No code files found in repository. Make sure the repo is public and contains code files." }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "No code files found in repository" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully fetched ${fileCount} files, total content length: ${codeContent.length} chars`);

    // 3. Send to AI for review with a strict, critical prompt
    const systemPrompt = `You are a STRICT and CRITICAL code reviewer and grading assistant for a coding bootcamp.
You MUST analyze the actual student code against the provided rubric criteria.

CRITICAL RULES:
- Be HONEST and STRICT. Do NOT give perfect scores unless the code is genuinely excellent.
- If the repository is empty, has only config files, or is missing required functionality, give a LOW score (0-30).
- If code has bugs, poor style, missing features, or doesn't meet rubric criteria, DEDUCT points accordingly.
- Each criterion should be evaluated independently based on actual evidence in the code.
- If a rubric criterion asks for something and the code doesn't implement it, mark it as FAILED.
- A score of 100 should be EXTREMELY rare - only for truly perfect submissions.
- Provide specific file names and line references in your feedback.
- If you see boilerplate/template code with no real implementation, score it very low.

You MUST respond using the grade_submission tool/function call. Do not respond with plain text.`;

    const userPrompt = `## Assignment: ${assignment.title}

## Grading Rubric:
${assignment.rubric_text || "No specific rubric provided. Grade on: code correctness, code quality, completeness, and best practices."}

## Student's Code (${fileCount} files fetched from repository):
${codeContent}

IMPORTANT: Analyze ONLY the code shown above. Grade strictly against each rubric criterion. If functionality is missing or incomplete, the score must reflect that. Do NOT assume the code works if you can see issues.`;

    console.log("Sending to AI for review...");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "grade_submission",
              description: "Grade a student code submission against a rubric. Be strict and honest.",
              parameters: {
                type: "object",
                properties: {
                  score: {
                    type: "number",
                    description: "Score out of 100. Should reflect actual code quality. 100 is extremely rare.",
                  },
                  feedback: {
                    type: "string",
                    description: "Detailed overall feedback referencing specific files and issues found. Include suggestions for improvement.",
                  },
                  criteria_results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        criterion: {
                          type: "string",
                          description: "Name of the grading criterion from the rubric",
                        },
                        passed: {
                          type: "boolean",
                          description: "Whether the student met this criterion based on actual code evidence",
                        },
                        comment: {
                          type: "string",
                          description: "Specific evidence from the code explaining why this passed or failed",
                        },
                      },
                      required: ["criterion", "passed", "comment"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["score", "feedback", "criteria_results"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "grade_submission" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);

      let errorMsg = "AI review failed";
      if (aiResponse.status === 429) errorMsg = "Rate limit exceeded. Please try again later.";
      if (aiResponse.status === 402) errorMsg = "AI credits exhausted. Please contact your administrator.";

      await supabase.from("submissions").update({ status: "error", feedback: errorMsg }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: errorMsg }),
        { status: aiResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();

    let result: { score: number; feedback: string; criteria_results: any[] };

    try {
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        result = JSON.parse(toolCall.function.arguments);
        console.log(`AI graded: score=${result.score}, criteria=${result.criteria_results?.length || 0}`);
      } else {
        const content = aiData.choices?.[0]?.message?.content || "";
        console.log("No tool call in response, attempting content parse. Content:", content.substring(0, 200));
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No structured response from AI");
        }
      }
    } catch (parseErr: any) {
      console.error("Parse error:", parseErr);
      await supabase.from("submissions").update({
        status: "error",
        feedback: "Failed to parse AI response. Please try again.",
      }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Save result
    const finalScore = Math.min(100, Math.max(0, Math.round(result.score)));
    const { error: updateError } = await supabase
      .from("submissions")
      .update({
        score: finalScore,
        feedback: result.feedback,
        criteria_results: result.criteria_results,
        status: "completed",
      })
      .eq("id", submission_id);

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to save review results" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Review complete for submission ${submission_id}: score=${finalScore}`);

    return new Response(
      JSON.stringify({
        success: true,
        score: finalScore,
        feedback: result.feedback,
        criteria_results: result.criteria_results,
        files_analyzed: fileCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("review-code error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
