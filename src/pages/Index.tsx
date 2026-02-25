import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Code2, ArrowRight, GitBranch, Brain, CheckCircle2 } from "lucide-react";
import { useEffect } from "react";

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate("/dashboard", { replace: true });
  }, [user, loading]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-20">
        <div className="animate-slide-in text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary score-glow">
            <Code2 className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="mb-4 text-5xl font-extrabold tracking-tight md:text-6xl">
            Code<span className="text-gradient-primary">Review</span>
          </h1>
          <p className="mx-auto mb-8 max-w-lg text-lg text-muted-foreground">
            AI-powered code grading for your LMS. Students submit repos, instructors set rubrics, and AI does the reviewing.
          </p>
          <Button size="lg" onClick={() => navigate("/auth")} className="group">
            Get Started
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </div>

        {/* Features */}
        <div className="mt-20 grid max-w-3xl gap-8 md:grid-cols-3">
          {[
            { icon: GitBranch, title: "Submit Repos", desc: "Students submit GitHub repository URLs for each assignment" },
            { icon: Brain, title: "AI Reviews", desc: "Code is analyzed against instructor-defined rubrics using AI" },
            { icon: CheckCircle2, title: "Instant Feedback", desc: "Get scores, corrections, and detailed criteria breakdown" },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                <Icon className="h-6 w-6 text-accent-foreground" />
              </div>
              <h3 className="mb-1 font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
