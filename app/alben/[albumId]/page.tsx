import AlbumPage from "@/app/albums/[albumId]/page";

export const dynamic = "force-dynamic";

type FriendlyAlbumPageProps = {
  params: Promise<{ albumId: string }> | { albumId: string };
};

export default function FriendlyAlbumPage({ params }: FriendlyAlbumPageProps) {
  return <AlbumPage params={params} />;
}
