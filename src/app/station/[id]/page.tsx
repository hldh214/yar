import ProgramSchedule from "@/components/ProgramSchedule";
import Link from "next/link";

export default async function StationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col flex-1 min-h-0 max-w-screen-xl mx-auto w-full px-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 py-1 flex-shrink-0"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
        Back to stations
      </Link>
      <ProgramSchedule stationId={id} />
    </div>
  );
}
