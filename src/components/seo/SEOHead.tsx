/**
 * Technical SEO Head Manager.
 *
 * Dynamically enforces:
 *  - Unique Page Title & Meta Description
 *  - Canonical URL for duplicate-free indexability
 *  - Open Graph & Twitter/X Social Sharing Cards
 *  - Structured JSON-LD Data (Organization, Breadcrumbs, Product, FAQ)
 */
import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export interface SEOHeadProps {
  title: string;
  description: string;
  canonicalPath?: string;
  image?: string;
  type?: 'website' | 'article' | 'product';
  jsonLd?: Record<string, any> | Array<Record<string, any>>;
  noindex?: boolean;
}

const DEFAULT_BASE_URL = 'https://kn-ecommerce-production.up.railway.app';
const DEFAULT_IMAGE = `${DEFAULT_BASE_URL}/hero-water-scene.webp`;

function setMetaTag(selector: string, attributeName: string, attributeValue: string, content: string): void {
  let el = document.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attributeName, attributeValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(url: string): void {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', url);
}

export const SEOHead: React.FC<SEOHeadProps> = ({
  title,
  description,
  canonicalPath,
  image = DEFAULT_IMAGE,
  type = 'website',
  jsonLd,
  noindex = false,
}) => {
  const location = useLocation();
  const currentPath = canonicalPath || location.pathname;
  const canonicalUrl = `${DEFAULT_BASE_URL}${currentPath === '/' ? '' : currentPath}`;
  const fullTitle = title.includes('K-SHOP') ? title : `${title} | K-SHOP`;

  useEffect(() => {
    // 1. Document Title
    document.title = fullTitle;

    // 2. Core Meta Description & Robots Directive
    setMetaTag('meta[name="description"]', 'name', 'description', description);
    setMetaTag('meta[name="robots"]', 'name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');

    // 3. Canonical URL
    setCanonical(canonicalUrl);

    // 4. Open Graph Tags
    setMetaTag('meta[property="og:title"]', 'property', 'og:title', fullTitle);
    setMetaTag('meta[property="og:description"]', 'property', 'og:description', description);
    setMetaTag('meta[property="og:url"]', 'property', 'og:url', canonicalUrl);
    setMetaTag('meta[property="og:image"]', 'property', 'og:image', image);
    setMetaTag('meta[property="og:type"]', 'property', 'og:type', type);
    setMetaTag('meta[property="og:site_name"]', 'property', 'og:site_name', 'K-SHOP Sovereign Luxury Marketplace');

    // 5. Twitter / X Cards
    setMetaTag('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
    setMetaTag('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle);
    setMetaTag('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    setMetaTag('meta[name="twitter:image"]', 'name', 'twitter:image', image);

    // 6. JSON-LD Structured Data Injection
    const scriptId = 'kshop-route-jsonld';
    let scriptEl = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (jsonLd) {
      if (!scriptEl) {
        scriptEl = document.createElement('script');
        scriptEl.id = scriptId;
        scriptEl.type = 'application/ld+json';
        document.head.appendChild(scriptEl);
      }
      scriptEl.textContent = JSON.stringify(
        Array.isArray(jsonLd)
          ? { '@context': 'https://schema.org', '@graph': jsonLd }
          : { '@context': 'https://schema.org', ...jsonLd }
      );
    } else if (scriptEl) {
      scriptEl.remove();
    }

    return () => {
      const el = document.getElementById(scriptId);
      if (el) el.remove();
    };
  }, [fullTitle, description, canonicalUrl, image, type, jsonLd]);

  return null;
};
