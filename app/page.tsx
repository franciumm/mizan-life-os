import type { Metadata } from "next";
import { MizanDashboard } from "./MizanDashboard";
import { ErrorBoundary } from "./ErrorBoundary";
export const metadata: Metadata = {
  title: "Mizan — Your life, in motion",
  description:
    "A private life operating system for faith, health, work, study, and growth.",
};

export default function Home() {
  return (
    <ErrorBoundary>
      <MizanDashboard />
    </ErrorBoundary>
  );
}
