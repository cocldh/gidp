import ChangeLogWindow from "./ChangeLogWindow";

export default async function ChangeLogPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId: raw } = await searchParams;
  const projectId = parseInt(raw ?? "0");
  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400 text-sm">
        Invalid project ID
      </div>
    );
  }
  return <ChangeLogWindow projectId={projectId} />;
}
