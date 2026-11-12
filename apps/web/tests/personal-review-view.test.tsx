import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { MovieDetailData } from "@film-shelf/shared";
import { MovieDetailView } from "../src/pages/MovieDetailView";

const movie: MovieDetailData = {
  title: "测试电影", originalTitle: "", mediaType: "movie", tmdbId: null, doubanId: null,
  episodeCount: null, posterUrl: null, releaseDate: null, overview: "电影简介正文", cast: [],
  watchedAt: null, magnetUrl: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  personalReview: null,
};

function renderReview(personalReview: string | null) {
  return renderToStaticMarkup(<MemoryRouter><MovieDetailView movie={{ ...movie, personalReview }} backTo="/" /></MemoryRouter>);
}

describe("personal review detail view", () => {
  test("preserves the complete review as plain text between synopsis and magnet", () => {
    const html = renderReview("  第一段，保留空格。\n\n第二段。  ");
    expect(html).toContain('<h2 id="detail-personal-review-heading">我的观后感</h2>');
    expect(html).toContain('<p class="detail-overview">  第一段，保留空格。\n\n第二段。  </p>');
    const synopsis = html.indexOf('aria-labelledby="detail-overview-heading"');
    const review = html.indexOf('aria-labelledby="detail-personal-review-heading"');
    const magnet = html.indexOf('aria-labelledby="detail-magnet-heading"');
    const cast = html.indexOf('aria-labelledby="detail-cast-heading"');
    expect(synopsis).toBeLessThan(review);
    expect(review).toBeLessThan(magnet);
    expect(magnet).toBeLessThan(cast);
  });

  test("does not show an empty review section for missing or whitespace-only content", () => {
    for (const review of [null, "", " \n\t　 "]) {
      const html = renderReview(review);
      expect(html).not.toContain("detail-personal-review-heading");
      expect(html).not.toContain("我的观后感");
      expect(html).toContain("电影简介正文");
    }
  });

  test("escapes markup in review text instead of interpreting it as HTML", () => {
    const html = renderReview('<script>alert("review")</script> & <strong>正文</strong>');
    expect(html).toContain("&lt;script&gt;alert(&quot;review&quot;)&lt;/script&gt; &amp; &lt;strong&gt;正文&lt;/strong&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<strong>正文</strong>");
  });

  test("also displays the review for a television entry without a magnet", () => {
    const html = renderToStaticMarkup(<MemoryRouter><MovieDetailView movie={{ ...movie, mediaType: "tv", magnetUrl: null, personalReview: "剧集感想" }} backTo="/" /></MemoryRouter>);
    expect(html).toContain("剧集简介");
    expect(html).toContain("我的观后感");
    expect(html).toContain("剧集感想");
    expect(html).not.toContain("detail-magnet-heading");
  });
});
