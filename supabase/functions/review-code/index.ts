import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface RequiredFile {
  path: string;
  description: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submission_id, repo_url, assignment_id } = await req.json();

    if (!submission_id || !repo_url || !assignment_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
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

    await supabase.from("submissions").update({ status: "reviewing" }).eq("id", submission_id);

    // 1. Fetch assignment with required_files
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("rubric_text, title, required_files")
      .eq("id", assignment_id)
      .single();

    if (assignmentError || !assignment) {
      await supabase.from("submissions").update({ status: "error", feedback: "Assignment not found" }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "Assignment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requiredFiles: RequiredFile[] = (assignment as any).required_files || [];

    // 2. Parse GitHub URL
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
    const cacheBuster = `_cb=${Date.now()}`;
    const githubHeaders: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "CodeReview-LMS",
      "If-None-Match": "",
    };

    // 3. Get default branch
    let defaultBranch = "main";
    const repoInfoResp = await fetch(
      `https://api.github.com/repos/${owner}/${cleanRepo}?${cacheBuster}`,
      { headers: githubHeaders }
    );
    if (repoInfoResp.ok) {
      const repoInfo = await repoInfoResp.json();
      defaultBranch = repoInfo.default_branch || "main";
    } else {
      await repoInfoResp.text();
    }
    console.log(`Repo: ${owner}/${cleanRepo}, branch: ${defaultBranch}`);

    // 4. Fetch code - either targeted files or full scan
    let codeContent = "";
    let fileCount = 0;
    const missingFiles: string[] = [];

    if (requiredFiles.length > 0) {
      // TARGETED MODE: fetch only the required files
      console.log(`Targeted mode: checking ${requiredFiles.length} required files`);

      for (const rf of requiredFiles) {
        try {
          const fileResp = await fetch(
            `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${defaultBranch}/${rf.path}?${cacheBuster}`,
            { headers: { "User-Agent": "CodeReview-LMS", "Cache-Control": "no-cache" } }
          );
          if (fileResp.ok) {
            const content = await fileResp.text();
            const trimmed = content.length > 5000 ? content.substring(0, 5000) + "\n... (truncated)" : content;
            codeContent += `\n--- FILE: ${rf.path} ---\n`;
            if (rf.description) codeContent += `[Expected: ${rf.description}]\n`;
            codeContent += `${trimmed}\n`;
            fileCount++;
          } else {
            await fileResp.text();
            missingFiles.push(rf.path);
            codeContent += `\n--- FILE: ${rf.path} ---\n[FILE NOT FOUND - This required file is missing from the repository]\n`;
            if (rf.description) codeContent += `[Expected: ${rf.description}]\n`;
          }
        } catch (err) {
          missingFiles.push(rf.path);
          codeContent += `\n--- FILE: ${rf.path} ---\n[ERROR: Could not fetch this file]\n`;
        }
      }

      console.log(`Found ${fileCount}/${requiredFiles.length} required files. Missing: ${missingFiles.join(", ") || "none"}`);
    } else {
      // FULL SCAN MODE: fetch all code files
      console.log("Full scan mode: checking all code files");

      try {
        const treeResp = await fetch(
          `https://api.github.com/repos/${owner}/${cleanRepo}/git/trees/${defaultBranch}?recursive=1&${cacheBuster}`,
          { headers: githubHeaders }
        );
        if (!treeResp.ok) {
          const errText = await treeResp.text();
          throw new Error(`Could not access repo tree (${treeResp.status}): ${errText}`);
        }
        const treeData = await treeResp.json();

        const codeExtensions = [".js", ".ts", ".tsx", ".jsx", ".py", ".java", ".css", ".html", ".json", ".md", ".rb", ".go", ".rs", ".c", ".cpp", ".h", ".php", ".sh", ".yaml", ".yml"];
        const codeFiles = (treeData.tree || [])
          .filter((f: any) => f.type === "blob" && codeExtensions.some((ext) => f.path.endsWith(ext)))
          .filter((f: any) => !f.path.includes("node_modules") && !f.path.includes(".lock") && !f.path.includes("dist/") && !f.path.includes("__pycache__"))
          .slice(0, 20);

        console.log(`Found ${codeFiles.length} code files`);

        for (const file of codeFiles) {
          try {
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
              await fileResp.text();
            }
          } catch {}
          if (codeContent.length > 30000) break;
        }
      } catch (err: any) {
        console.error("GitHub fetch error:", err.message);
        await supabase.from("submissions").update({ status: "error", feedback: "Failed to fetch code: " + err.message }).eq("id", submission_id);
        return new Response(
          JSON.stringify({ error: err.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!codeContent.trim()) {
      await supabase.from("submissions").update({ status: "error", feedback: "No code files found in repository." }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "No code files found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Fetched ${fileCount} files, ${codeContent.length} chars total`);

    // 5. Build AI prompt
    let fileContext = "";
    if (requiredFiles.length > 0) {
      fileContext = `\n\nREQUIRED FILES SPECIFIED BY INSTRUCTOR:\n${requiredFiles.map((f) => `- ${f.path}${f.description ? `: ${f.description}` : ""}`).join("\n")}`;
      if (missingFiles.length > 0) {
        fileContext += `\n\nMISSING FILES (student did not create these): ${missingFiles.join(", ")}`;
        fileContext += `\nIMPORTANT: Missing required files should result in significant point deductions.`;
      }
    }

    const systemPrompt = `You are a STRICT and CRITICAL code reviewer and grading assistant for a coding bootcamp.

ABSOLUTE RULES — VIOLATION OF ANY RULE IS UNACCEPTABLE:
1. You have ZERO prior knowledge of this student's code. You are seeing it for the FIRST TIME right now.
2. Do NOT assume any code exists that is not explicitly shown below. If you cannot see it, it does NOT exist.
3. For EVERY claim you make (positive or negative), you MUST cite the exact file name AND line number(s) as evidence.
4. If a rubric criterion requires a specific variable, function, class, or check and you do NOT see it in the code below, you MUST mark it as FAILED and deduct points. No exceptions.
5. If required files are specified and missing from the repo, HEAVILY penalize the score (at least -20 per missing file).
6. If the repository is empty or has only boilerplate/template code with no real implementation, score 0-20.
7. Each criterion MUST be evaluated independently based ONLY on what is visible in the code below.
8. A score of 100 should be EXTREMELY rare — only for genuinely flawless code.
9. Do NOT be generous. Do NOT give benefit of the doubt. Grade ONLY what you can see.
10. If code has syntax errors, missing imports, undefined variables, or logical bugs, call them out and deduct points.

REMEMBER: The code below is the ONLY truth. Ignore any prior context or assumptions. Grade THIS code, not what you think it might be.

You MUST respond using the grade_submission tool/function call.`;

    const userPrompt = `## UNIQUE REVIEW SESSION: ${crypto.randomUUID()}
## Timestamp: ${new Date().toISOString()}
## Assignment: ${assignment.title}
${fileContext}

## Grading Rubric:
${assignment.rubric_text || "Grade on: code correctness, code quality, completeness, and best practices."}

## Student's Code (${fileCount} files fetched FRESH from repository just now):
IMPORTANT: The code below was fetched at ${new Date().toISOString()}. This is the ONLY version that matters. Grade ONLY this code.
${codeContent}

Analyze ONLY the code shown above. For every criterion, cite exact file names and line numbers. If something required is missing from the code above, mark it FAILED.`;

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
                  score: { type: "number", description: "Score out of 100. 100 is extremely rare." },
                  feedback: { type: "string", description: "Detailed feedback referencing specific files and issues." },
                  criteria_results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        criterion: { type: "string", description: "Name of the grading criterion" },
                        passed: { type: "boolean", description: "Whether the student met this criterion" },
                        comment: { type: "string", description: "Evidence from the code explaining pass/fail" },
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
      if (aiResponse.status === 429) errorMsg = "Rate limit exceeded. Try again later.";
      if (aiResponse.status === 402) errorMsg = "AI credits exhausted.";
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
        console.log(`AI graded: score=${result.score}`);
      } else {
        const content = aiData.choices?.[0]?.message?.content || "";
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No structured response from AI");
        }
      }
    } catch (parseErr: any) {
      console.error("Parse error:", parseErr);
      await supabase.from("submissions").update({ status: "error", feedback: "Failed to parse AI response." }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const finalScore = Math.min(100, Math.max(0, Math.round(result.score)));
    await supabase.from("submissions").update({
      score: finalScore,
      feedback: result.feedback,
      criteria_results: result.criteria_results,
      status: "completed",
    }).eq("id", submission_id);

    console.log(`Review complete: submission=${submission_id}, score=${finalScore}`);

    return new Response(
      JSON.stringify({ success: true, score: finalScore, feedback: result.feedback, criteria_results: result.criteria_results, files_analyzed: fileCount, missing_files: missingFiles }),
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
