/**
 * Resolves an image URL, applying Supabase Storage image transformations
 * when applicable (serving WebP at appropriate widths and quality),
 * while falling back safely to the original URL if not a transformable Supabase URL.
 */
export function getOptimizedImageUrl(
  url: string | null | undefined,
  options: { width?: number; quality?: number; height?: number } = {}
): string {
  if (!url || typeof url !== 'string') return '';
  
  // Transform Supabase storage public URLs:
  // /storage/v1/object/public/ -> /storage/v1/render/image/public/
  if (url.includes('/storage/v1/object/public/')) {
    const width = options.width || 360;
    const quality = options.quality || 75;
    const transformed = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    const separator = transformed.includes('?') ? '&' : '?';
    let query = `width=${width}&quality=${quality}`;
    if (options.height) {
      query += `&height=${options.height}`;
    }
    return `${transformed}${separator}${query}`;
  }
  
  return url;
}
