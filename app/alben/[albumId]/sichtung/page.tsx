import AlbumPage from "@/app/albums/[albumId]/page";

export const dynamic = "force-dynamic";

type FriendlyAlbumReviewPageProps = {
  params: Promise<{ albumId: string }> | { albumId: string };
  searchParams?: Promise<{ filter?: string }> | { filter?: string };
};

export default async function FriendlyAlbumReviewPage({
  params,
  searchParams,
}: FriendlyAlbumReviewPageProps) {
  const query = searchParams ? await searchParams : {};

  return <AlbumPage params={params} searchParams={{ ...query, view: "stamps" }} />;
}
