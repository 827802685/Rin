import type { ReactNode } from "react";
import { Helmet } from "react-helmet";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { siteName } from "../utils/constants";
import { stripImageUrlMetadata } from "../utils/image-upload";

interface SiteMetaProps {
    /** Page title without the site name; the suffix is added automatically. */
    title?: string;
    description?: string;
    image?: string;
    /** Comma separated keywords for the `keywords` meta tag. */
    keywords?: string;
    author?: string;
    /** Defaults to the current document URL. */
    url?: string;
    /** Open Graph type; pages use "article", the shell uses "website". */
    type?: string;
    children?: ReactNode;
}

/**
 * Single source of truth for page level metadata.
 *
 * Every public page used to repeat the same six `<meta>` tags inside its own
 * `<Helmet>`. Centralising them keeps the Open Graph output consistent and
 * makes SEO changes a one line edit.
 */
export function SiteMeta({
    title,
    description,
    image,
    keywords,
    author,
    url,
    type = "article",
    children,
}: SiteMetaProps) {
    const siteConfig = useSiteConfig();

    const documentTitle = title ? `${title} - ${siteConfig.name}` : siteConfig.name;
    const pageDescription = description || siteConfig.description;
    const pageImage = stripImageUrlMetadata(image || siteConfig.avatar);
    const pageUrl = url ?? (typeof document === "undefined" ? "" : document.URL);

    return (
        <>
            <Helmet>
                <title>{documentTitle}</title>
                <meta property="og:site_name" content={siteName} />
                <meta property="og:title" content={title || siteConfig.name} />
                {pageDescription && <meta name="description" content={pageDescription} />}
                {pageDescription && <meta property="og:description" content={pageDescription} />}
                {pageImage && <meta property="og:image" content={pageImage} />}
                <meta property="og:type" content={type} />
                {pageUrl && <meta property="og:url" content={pageUrl} />}
                {keywords ? <meta name="keywords" content={keywords} /> : null}
                {author ? <meta name="author" content={author} /> : null}
            </Helmet>
            {children}
        </>
    );
}
