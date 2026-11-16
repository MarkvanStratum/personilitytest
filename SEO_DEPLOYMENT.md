# SEO deployment and verification

- Deploy all files from this package to your existing GitHub/Northflank project.
- The original external checkout HTML files and payment APIs were preserved; Stripe test transactions were NOT run.
- Public SEO routes: `/personality-types/`, 16 individual type pages, `/mbti-guide/`, `/personality-test/`.
- `sitemap.xml` and `robots.txt` are available at the site root.
- Verify `https://16personalities.eu` is the correct canonical domain and that HTTPS works; change canonical URLs if your actual primary domain differs.
- Add the domain to Google Search Console, verify DNS ownership, submit `https://16personalities.eu/sitemap.xml`.
- Use Search Console URL Inspection on homepage and a few type pages; check indexing over subsequent weeks.
- Test the 32-question assessment, result access, admin preview, both Stripe plans, webhook, and checkout before live traffic.
- Public type guides are independently written educational content, not official MBTI reports. Review accuracy and refine with first-hand expertise. No search ranking can be guaranteed.
- Homepage no longer automatically redirects returning assessment visitors to their results: this allows a stable, indexable homepage. Their results remain available through the results URL.
