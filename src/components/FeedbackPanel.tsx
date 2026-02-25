import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface CriteriaResult {
  criterion: string;
  passed: boolean;
  comment: string;
}

interface FeedbackPanelProps {
  feedback: string;
  criteriaResults: CriteriaResult[] | null;
  score: number | null;
}

const FeedbackPanel = ({ feedback, criteriaResults, score }: FeedbackPanelProps) => {
  return (
    <div className="space-y-4 animate-slide-in">
      {/* Overall feedback */}
      <Card className="bg-muted/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">AI Feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{feedback}</p>
        </CardContent>
      </Card>

      {/* Criteria results */}
      {criteriaResults && criteriaResults.length > 0 && (
        <Card className="bg-muted/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Criteria Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {criteriaResults.map((result, index) => (
              <div
                key={index}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  result.passed ? "border-success/20 bg-success/5" : "border-destructive/20 bg-destructive/5"
                }`}
              >
                {result.passed ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                )}
                <div>
                  <p className="text-sm font-medium">{result.criterion}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{result.comment}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default FeedbackPanel;
