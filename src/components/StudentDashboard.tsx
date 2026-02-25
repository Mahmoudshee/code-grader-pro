import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { GitBranch, Send, Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import ScoreDisplay from "@/components/ScoreDisplay";
import FeedbackPanel from "@/components/FeedbackPanel";

type Assignment = Tables<"assignments">;
type Submission = Tables<"submissions">;

const StudentDashboard = () => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const fetchData = async () => {
    const { data: assignmentData } = await supabase
      .from("assignments")
      .select("*")
      .order("created_at", { ascending: false });

    if (assignmentData) setAssignments(assignmentData);

    const { data: submissionData } = await supabase
      .from("submissions")
      .select("*")
      .eq("student_id", user!.id)
      .order("created_at", { ascending: false });

    if (submissionData) {
      const grouped: Record<string, Submission[]> = {};
      submissionData.forEach((s) => {
        if (!grouped[s.assignment_id]) grouped[s.assignment_id] = [];
        grouped[s.assignment_id].push(s);
      });
      setSubmissions(grouped);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const handleSubmit = async (assignmentId: string) => {
    if (!repoUrl.trim()) {
      toast.error("Please enter a GitHub repo URL");
      return;
    }

    const urlPattern = /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/;
    if (!urlPattern.test(repoUrl.trim())) {
      toast.error("Please enter a valid GitHub repository URL");
      return;
    }

    setSubmitting(true);
    const existingSubs = submissions[assignmentId] || [];
    const attemptNumber = existingSubs.length + 1;

    const { data: submission, error } = await supabase
      .from("submissions")
      .insert({
        assignment_id: assignmentId,
        student_id: user!.id,
        repo_url: repoUrl.trim(),
        attempt_number: attemptNumber,
        status: "pending",
      })
      .select()
      .single();

    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Repo submitted! Click 'Check Code' to start AI review.");
    setRepoUrl("");
    setSelectedAssignment(null);
    fetchData();
  };

  const handleCheckCode = async (submission: Submission) => {
    setReviewing(submission.id);

    try {
      const response = await supabase.functions.invoke("review-code", {
        body: {
          submission_id: submission.id,
          repo_url: submission.repo_url,
          assignment_id: submission.assignment_id,
        },
      });

      if (response.error) {
        toast.error("Review failed: " + (response.error.message || "Unknown error"));
      } else {
        toast.success("Code review complete!");
      }
    } catch (err: any) {
      toast.error("Failed to trigger review: " + err.message);
    }

    setReviewing(null);
    fetchData();
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">My Assignments</h2>
        <p className="text-muted-foreground">Submit your code and get AI-powered feedback</p>
      </div>

      {assignments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <GitBranch className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <h3 className="text-lg font-semibold">No assignments yet</h3>
            <p className="text-muted-foreground">Your instructor hasn't created any assignments yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {assignments.map((assignment) => {
            const subs = submissions[assignment.id] || [];
            const latestSub = subs[0];

            return (
              <Card key={assignment.id} className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-xl">{assignment.title}</CardTitle>
                      {assignment.description && <CardDescription className="mt-1">{assignment.description}</CardDescription>}
                    </div>
                    {latestSub?.status === "completed" && latestSub.score !== null && (
                      <ScoreDisplay score={latestSub.score} />
                    )}
                  </div>
                  {assignment.due_date && (
                    <p className="text-xs text-muted-foreground">
                      Due: {new Date(assignment.due_date).toLocaleDateString()}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Submit repo */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://github.com/username/repo"
                      value={selectedAssignment?.id === assignment.id ? repoUrl : (latestSub?.repo_url || "")}
                      onChange={(e) => {
                        setSelectedAssignment(assignment);
                        setRepoUrl(e.target.value);
                      }}
                      onFocus={() => {
                        setSelectedAssignment(assignment);
                        if (!repoUrl) setRepoUrl(latestSub?.repo_url || "");
                      }}
                      className="font-mono text-sm"
                    />
                    <Button
                      onClick={() => handleSubmit(assignment.id)}
                      disabled={submitting || selectedAssignment?.id !== assignment.id || !repoUrl.trim()}
                      variant="secondary"
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Submit
                    </Button>
                  </div>

                  {/* Latest submission status */}
                  {latestSub && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          {latestSub.status === "completed" && <CheckCircle2 className="h-4 w-4 text-success" />}
                          {latestSub.status === "pending" && <AlertCircle className="h-4 w-4 text-warning" />}
                          {latestSub.status === "reviewing" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                          {latestSub.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                          <span className="capitalize text-muted-foreground">
                            {latestSub.status} · Attempt #{latestSub.attempt_number}
                          </span>
                        </div>
                        {(latestSub.status === "pending" || latestSub.status === "completed" || latestSub.status === "error") && (
                          <Button
                            size="sm"
                            onClick={() => handleCheckCode(latestSub)}
                            disabled={reviewing === latestSub.id}
                          >
                            {reviewing === latestSub.id ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Reviewing...
                              </>
                            ) : (
                              "Check Code"
                            )}
                          </Button>
                        )}
                      </div>

                      {latestSub.status === "completed" && latestSub.feedback && (
                        <FeedbackPanel
                          feedback={latestSub.feedback}
                          criteriaResults={latestSub.criteria_results as any}
                          score={latestSub.score}
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StudentDashboard;
