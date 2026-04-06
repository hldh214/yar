import StationList from "@/components/StationList";

export default function Home() {
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto max-w-screen-xl mx-auto w-full px-4 py-2"
      style={{ paddingBottom: 'var(--player-bar-h, 0px)' }}
    >
      <StationList />
    </div>
  );
}
