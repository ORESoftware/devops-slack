export async function importBrowserLibrary(specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    if (process.env.REQUIRE_E2E_DEPENDENCIES === "true") throw error;
    return null;
  }
}
