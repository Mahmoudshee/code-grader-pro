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
    // Parse owner/repo from URL
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

    // Fetch repo tree to get file list
    let codeContent = "";
    try {
      const treeResp = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepo}/git/trees/main?recursive=1`,
        { headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "CodeReview-LMS" } }
      );

      let treeData: any;
      if (!treeResp.ok) {
        // Try 'master' branch
        const masterResp = await fetch(
          `https://api.github.com/repos/${owner}/${cleanRepo}/git/trees/master?recursive=1`,
          { headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "CodeReview-LMS" } }
        );
        if (!masterResp.ok) {
          throw new Error("Could not access repository. Ensure it's public.");
        }
        treeData = await masterResp.json();
      } else {
        treeData = await treeResp.json();
      }

      // Filter for code files, limit to reasonable size
      const codeExtensions = [".js", ".ts", ".tsx", ".jsx", ".py", ".java", ".css", ".html", ".json", ".md", ".rb", ".go", ".rs", ".c", ".cpp", ".h"];
      const codeFiles = (treeData.tree || [])
        .filter((f: any) => f.type === "blob" && codeExtensions.some((ext) => f.path.endsWith(ext)))
        .filter((f: any) => !f.path.includes("node_modules") && !f.path.includes(".lock") && !f.path.includes("dist/"))
        .slice(0, 15); // Limit files

      for (const file of codeFiles) {
        try {
          const fileResp = await fetch(
            `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${file.path}`,
            { headers: { Accept: "application/vnd.github.v3.raw", "User-Agent": "CodeReview-LMS" } }
          );
          if (fileResp.ok) {
            const content = await fileResp.text();
            // Limit per-file content
            const trimmed = content.length > 3000 ? content.substring(0, 3000) + "\n... (truncated)" : content;
            codeContent += `\n--- FILE: ${file.path} ---\n${trimmed}\n`;
          }
        } catch {
          // Skip failed files
        }

        if (codeContent.length > 30000) break; // Total limit
      }
    } catch (err: any) {
      await supabase.from("submissions").update({ status: "error", feedback: "Failed to fetch code: " + err.message }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "Failed to fetch code from GitHub: " + err.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!codeContent.trim()) {
      await supabase.from("submissions").update({ status: "error", feedback: "No code files found in repository" }).eq("id", submission_id);
      return new Response(
        JSON.stringify({ error: "No code files found in repository" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Send to AI for review
    const systemPrompt = `You are an expert code reviewer and grading assistant for a coding bootcamp LMS.
You must analyze student code against the provided rubric and return a structured assessment.

IMPORTANT: You MUST respond using the grade_submission tool/function call. Do not respond with plain text.`;

    const userPrompt = `## Assignment: ${assignment.title}

## Grading Rubric:
${assignment.rubric_text}

## Student's Code:
${codeContent}

Analyze the student's code against the rubric above. Provide a thorough assessment.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "grade_submission",
              description: "Grade a student code submission against a rubric",
              parameters: {
                type: "object",
                properties: {
                  score: {
                    type: "number",
                    description: "Score out of 100",
                  },
                  feedback: {
                    type: "string",
                    description: "Detailed overall feedback and suggestions for improvement",
                  },
                  criteria_results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        criterion: {
                          type: "string",
                          description: "Name of the grading criterion",
                        },
                        passed: {
                          type: "boolean",
                          description: "Whether the student met this criterion",
                        },
                        comment: {
                          type: "string",
                          description: "Detailed comment about this criterion",
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
      } else {
        // Fallback: try to parse from content
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
    const { error: updateError } = await supabase
      .from("submissions")
      .update({
        score: Math.min(100, Math.max(0, Math.round(result.score))),
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

    return new Response(
      JSON.stringify({
        success: true,
        score: result.score,
        feedback: result.feedback,
        criteria_results: result.criteria_results,
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
