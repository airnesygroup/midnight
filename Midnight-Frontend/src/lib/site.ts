/** Public site identity: one place for the domain used in canonical links, share tags, sitemap and emails. */
export const SITE_URL = "https://themidnightnews.com";
export const SITE_NAME = "Midnight";
export const EMAIL_DOMAIN = "themidnightnews.com";
export const CONTACT_EMAIL = `hello@${EMAIL_DOMAIN}`;

/** Absolute URL on the public domain for a site path ("/article/x" → "https://themidnightnews.com/article/x"). */
export const absUrl = (path = "/") => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`);
