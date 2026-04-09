function extractUrlBlocks(xml: string): string[] {
  return xml.match(/<url\b[^>]*>[\s\S]*?<\/url>/gi) || [];
}

export function findPlaylistCreateUrl(
  xml: string,
  options: { timefree: boolean; areafree: boolean }
): string {
  const urlBlocks = extractUrlBlocks(xml);
  if (urlBlocks.length === 0) {
    throw new Error("no stream URLs found in XML");
  }

  const timefreeValue = options.timefree ? "1" : "0";
  const areafreeValue = options.areafree ? "1" : "0";
  const matchedBlock = urlBlocks.find((block) => {
    const tag = block.match(/<url\b[^>]*>/i)?.[0] || "";
    return (
      new RegExp(`timefree="${timefreeValue}"`, "i").test(tag) &&
      new RegExp(`areafree="${areafreeValue}"`, "i").test(tag)
    );
  });

  if (!matchedBlock) {
    throw new Error("no matching stream URL found");
  }

  const playlistMatch = matchedBlock.match(
    /<playlist_create_url>([^<]+)<\/playlist_create_url>/i
  );
  if (!playlistMatch) {
    throw new Error("no playlist_create_url found");
  }

  return playlistMatch[1].trim();
}
