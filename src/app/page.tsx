import { getFrontPage } from "@/lib/pipeline/getFrontPage";

export default async function Home() {
  const result = await getFrontPage();
  const articles = result.status === "ok" ? result.articles : [];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
        Havadis
      </h1>

      {articles.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          No articles in the last 24 hours.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {articles.map((article, index) => (
            <li key={`${article.url}-${index}`}>
              <a
                href={article.url}
                className="text-lg font-medium text-zinc-950 hover:underline dark:text-zinc-50"
              >
                {article.title}
              </a>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {article.source}
                {" · "}
                <time dateTime={article.publishedAt}>
                  {new Date(article.publishedAt).toLocaleString()}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
