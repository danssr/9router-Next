// ESM resolver for the repo's jsconfig aliases, so scripts can import src/ and
// open-sse/ modules under plain node (no Next bundler):
//   "@/*"      -> src/*
//   "open-sse" -> open-sse   "open-sse/*" -> open-sse/*
export async function resolve(specifier, context, next) {
  const base = new URL("../", import.meta.url); // repo root (loader lives in scripts/)
  if (specifier.startsWith("@/")) {
    return next(new URL("src/" + specifier.slice(2), base).href, context);
  }
  if (specifier === "open-sse" || specifier.startsWith("open-sse/")) {
    return next(new URL(specifier, base).href, context);
  }
  return next(specifier, context);
}
