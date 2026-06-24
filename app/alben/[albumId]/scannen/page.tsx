import AlbumPage from "@/app/albums/[albumId]/page";

export const dynamic = "force-dynamic";

type FriendlyAlbumCapturePageProps = {
  params: Promise<{ albumId: string }> | { albumId: string };
};

export default function FriendlyAlbumCapturePage({
  params,
}: FriendlyAlbumCapturePageProps) {
  return <AlbumPage params={params} searchParams={{ view: "capture" }} />;
}
