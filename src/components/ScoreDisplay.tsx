interface ScoreDisplayProps {
  score: number;
}

const ScoreDisplay = ({ score }: ScoreDisplayProps) => {
  const getScoreColor = () => {
    if (score >= 80) return "text-success";
    if (score >= 60) return "text-score-good";
    if (score >= 40) return "text-warning";
    return "text-destructive";
  };

  const getScoreBg = () => {
    if (score >= 80) return "bg-success/10 border-success/20";
    if (score >= 60) return "bg-score-good/10 border-score-good/20";
    if (score >= 40) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  return (
    <div className={`flex items-center justify-center rounded-xl border-2 px-4 py-2 ${getScoreBg()}`}>
      <span className={`text-3xl font-bold font-mono ${getScoreColor()}`}>{score}</span>
      <span className="ml-1 text-sm text-muted-foreground">/100</span>
    </div>
  );
};

export default ScoreDisplay;
