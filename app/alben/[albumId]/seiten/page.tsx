import AlbumPage from "@/app/albums/[albumId]/page";

export const dynamic = "force-dynamic";

type FriendlyAlbumPagesPageProps = {
  params: Promise<{ albumId: string }> | { albumId: string };
  searchParams?: Promise<{ filter?: string }> | { filter?: string };
};

export default async function FriendlyAlbumPagesPage({
  params,
  searchParams,
}: FriendlyAlbumPagesPageProps) {
  const query = searchParams ? await searchParams : {};

  return <AlbumPage params={params} searchParams={{ ...query, view: "pages" }} />;
}
