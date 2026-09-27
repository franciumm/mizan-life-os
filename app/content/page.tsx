import { MizanDashboard } from '../MizanDashboard';
import { ErrorBoundary } from '../ErrorBoundary';
export default function ContentPage() { return <ErrorBoundary><MizanDashboard initialView="content" /></ErrorBoundary>; }
