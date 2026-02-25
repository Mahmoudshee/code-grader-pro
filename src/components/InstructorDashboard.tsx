import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, BookOpen, Users, Clock } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Assignment = Tables<"assignments">;

const InstructorDashboard = () => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rubricText, setRubricText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchAssignments = async () => {
    const { data, error } = await supabase
      .from("assignments")
      .select("*")
      .eq("instructor_id", user!.id)
      .order("created_at", { ascending: false });
    if (!error && data) setAssignments(data);
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchAssignments();
  }, [user]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !rubricText.trim()) {
      toast.error("Title and rubric are required");
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("assignments").insert({
      title: title.trim(),
      description: description.trim(),
      rubric_text: rubricText.trim(),
      instructor_id: user!.id,
      due_date: dueDate || null,
    });
    setCreating(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Assignment created!");
      setTitle("");
      setDescription("");
      setRubricText("");
      setDueDate("");
      setDialogOpen(false);
      fetchAssignments();
    }
  };

  const [submissionCounts, setSubmissionCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchCounts = async () => {
      for (const a of assignments) {
        const { count } = await supabase
          .from("submissions")
          .select("*", { count: "exact", head: true })
          .eq("assignment_id", a.id);
        setSubmissionCounts(prev => ({ ...prev, [a.id]: count || 0 }));
      }
    };
    if (assignments.length > 0) fetchCounts();
  }, [assignments]);

  if (loading) {
    return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Assignments</h2>
          <p className="text-muted-foreground">Create and manage your coding assignments</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Assignment
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Assignment</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" placeholder="e.g. React Todo App" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" placeholder="Describe the assignment..." value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rubric">Grading Rubric / AI Instructions</Label>
                <Textarea
                  id="rubric"
                  placeholder="e.g. Act as a Senior Developer. Check if the student used map() instead of for-loops, ensure they implemented validation logic, and check if variable names are in camelCase. Give a score out of 100."
                  value={rubricText}
                  onChange={(e) => setRubricText(e.target.value)}
                  rows={5}
                  required
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">This prompt will be sent to the AI to grade student code.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="due_date">Due Date (optional)</Label>
                <Input id="due_date" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? "Creating..." : "Create Assignment"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {assignments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <h3 className="text-lg font-semibold">No assignments yet</h3>
            <p className="text-muted-foreground">Create your first assignment to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {assignments.map((a) => (
            <Card key={a.id} className="transition-all hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-lg">{a.title}</CardTitle>
                {a.description && <CardDescription className="line-clamp-2">{a.description}</CardDescription>}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {submissionCounts[a.id] ?? 0} submissions
                  </span>
                  {a.due_date && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {new Date(a.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="mt-3 rounded-md bg-muted p-2">
                  <p className="line-clamp-2 font-mono text-xs text-muted-foreground">{a.rubric_text}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default InstructorDashboard;
