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
import { Plus, BookOpen, Users, Clock, Pencil, X, FileCode } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Assignment = Tables<"assignments">;

interface RequiredFile {
  path: string;
  description: string;
}

const InstructorDashboard = () => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rubricText, setRubricText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [requiredFiles, setRequiredFiles] = useState<RequiredFile[]>([]);
  const [newFilePath, setNewFilePath] = useState("");
  const [newFileDesc, setNewFileDesc] = useState("");
  const [saving, setSaving] = useState(false);

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

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setRubricText("");
    setDueDate("");
    setRequiredFiles([]);
    setNewFilePath("");
    setNewFileDesc("");
    setEditingAssignment(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (a: Assignment) => {
    setEditingAssignment(a);
    setTitle(a.title);
    setDescription(a.description || "");
    setRubricText(a.rubric_text || "");
    setDueDate(a.due_date ? new Date(a.due_date).toISOString().slice(0, 16) : "");
    setRequiredFiles((a as any).required_files || []);
    setDialogOpen(true);
  };

  const addRequiredFile = () => {
    if (!newFilePath.trim()) return;
    setRequiredFiles((prev) => [...prev, { path: newFilePath.trim(), description: newFileDesc.trim() }]);
    setNewFilePath("");
    setNewFileDesc("");
  };

  const removeRequiredFile = (index: number) => {
    setRequiredFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !rubricText.trim()) {
      toast.error("Title and rubric are required");
      return;
    }
    setSaving(true);

    const filesJson = JSON.parse(JSON.stringify(requiredFiles));

    if (editingAssignment) {
      const { error } = await supabase
        .from("assignments")
        .update({
          title: title.trim(),
          description: description.trim(),
          rubric_text: rubricText.trim(),
          due_date: dueDate || null,
          required_files: filesJson,
        })
        .eq("id", editingAssignment.id);
      setSaving(false);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Assignment updated!");
        resetForm();
        setDialogOpen(false);
        fetchAssignments();
      }
    } else {
      const { error } = await supabase.from("assignments").insert([{
        title: title.trim(),
        description: description.trim(),
        rubric_text: rubricText.trim(),
        due_date: dueDate || null,
        required_files: filesJson,
        instructor_id: user!.id,
      }]);
      setSaving(false);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Assignment created!");
        resetForm();
        setDialogOpen(false);
        fetchAssignments();
      }
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
        setSubmissionCounts((prev) => ({ ...prev, [a.id]: count || 0 }));
      }
    };
    if (assignments.length > 0) fetchCounts();
  }, [assignments]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Assignments</h2>
          <p className="text-muted-foreground">Create and manage your coding assignments</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New Assignment
        </Button>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAssignment ? "Edit Assignment" : "Create Assignment"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="e.g. Check if the student implemented a calculator with add, subtract, multiply functions. Ensure proper error handling..."
                value={rubricText}
                onChange={(e) => setRubricText(e.target.value)}
                rows={5}
                required
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">This prompt will be sent to the AI to grade student code.</p>
            </div>

            {/* Required Files Section */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <FileCode className="h-4 w-4" />
                Required Files to Check
              </Label>
              <p className="text-xs text-muted-foreground">
                Specify exact file paths the AI should look for and review. If left empty, the AI will scan all code files.
              </p>

              {requiredFiles.length > 0 && (
                <div className="space-y-2">
                  {requiredFiles.map((file, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border bg-muted/50 p-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm truncate">{file.path}</p>
                        {file.description && <p className="text-xs text-muted-foreground">{file.description}</p>}
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeRequiredFile(i)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  placeholder="e.g. calculator.py or src/utils.js"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  className="font-mono text-sm"
                />
                <Button type="button" variant="outline" size="sm" onClick={addRequiredFile} disabled={!newFilePath.trim()}>
                  Add
                </Button>
              </div>
              <Input
                placeholder="What should this file do? (optional)"
                value={newFileDesc}
                onChange={(e) => setNewFileDesc(e.target.value)}
                className="text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="due_date">Due Date (optional)</Label>
              <Input id="due_date" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Saving..." : editingAssignment ? "Update Assignment" : "Create Assignment"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

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
          {assignments.map((a) => {
            const files = (a as any).required_files as RequiredFile[] || [];
            return (
              <Card key={a.id} className="transition-all hover:shadow-md">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-lg">{a.title}</CardTitle>
                      {a.description && <CardDescription className="line-clamp-2">{a.description}</CardDescription>}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openEdit(a)}>
                      <Pencil className="mr-1 h-3 w-3" />
                      Edit
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
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
                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {files.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-mono text-xs">
                          <FileCode className="h-3 w-3" />
                          {f.path}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="rounded-md bg-muted p-2">
                    <p className="line-clamp-2 font-mono text-xs text-muted-foreground">{a.rubric_text}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InstructorDashboard;
