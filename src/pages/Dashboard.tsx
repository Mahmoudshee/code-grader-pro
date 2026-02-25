import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import InstructorDashboard from "@/components/InstructorDashboard";
import StudentDashboard from "@/components/StudentDashboard";
import AppLayout from "@/components/AppLayout";

const Dashboard = () => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <AppLayout>
      {profile?.role === "instructor" ? <InstructorDashboard /> : <StudentDashboard />}
    </AppLayout>
  );
};

export default Dashboard;
