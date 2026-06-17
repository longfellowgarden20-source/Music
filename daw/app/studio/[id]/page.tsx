import DAWStudio from "./DAWStudio";

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DAWStudio trackId={parseInt(id)} />;
}
