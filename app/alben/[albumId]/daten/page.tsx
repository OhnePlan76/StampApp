import AlbumPage from "@/app/albums/[albumId]/page";

export const dynamic = "force-dynamic";

type FriendlyAlbumDataPageProps = {
  params: Promise<{ albumId: string }> | { albumId: string };
};

export default function FriendlyAlbumDataPage({ params }: FriendlyAlbumDataPageProps) {
  return <AlbumPage params={params} searchParams={{ view: "edit" }} />;
}
