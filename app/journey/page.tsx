import { MizanDashboard } from '../MizanDashboard';
import { ErrorBoundary } from '../ErrorBoundary';

export default function JourneyPage() {
  return <ErrorBoundary><MizanDashboard initialView="journey" /></ErrorBoundary>;
}
