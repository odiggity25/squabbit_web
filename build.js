const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const headerNav = fs.readFileSync(path.join(ROOT, 'header-nav.html'), 'utf8');
const footerContent = fs.readFileSync(path.join(ROOT, 'footer-content.html'), 'utf8');

// Google Analytics belongs once per page, in the <head> (matches how index.html
// and the other hand-maintained pages already do it). It used to live inside the
// header-nav.html fragment, so build.js injected it into the <body> next to the
// nav and every re-run stacked another copy (the "run build.js and it doubles GA"
// footgun). GA now lives here and is injected into <head>; header-nav.html is a
// pure <nav> fragment.
const GA_SNIPPET = `<!-- Google Analytics (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-VK78NGGL18"></script>
<script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-VK78NGGL18');
</script>`;

const NAV_TAG_START = '<nav class="navbar navbar-expand-lg navbar-light fixed-top shadow-sm" id="mainNav">';
const escapeForRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const gaPattern = escapeForRegex(GA_SNIPPET).replace(/\s+/g, '\\s*');
// Match the nav plus ANY number of stale GA blocks a previous build injected in
// front of it, so re-inlining strips the old body-level GA (leaving the single
// <head> copy) and never duplicates — idempotent and self-healing.
const NAV_BLOCK_REGEX = new RegExp(
    '(?:' + gaPattern + '\\s*)*' + escapeForRegex(NAV_TAG_START) + '[\\s\\S]*?</nav>',
    'g'
);

const NAV_CSS_LINKS = `    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet" />
    <link href="/css/nav.css" rel="stylesheet">`;

const EXCLUDED_FILES = new Set([
    'header.html',
    'footer.html',
    'header-nav.html',
    'footer-content.html',
    'admin.html',
    'stripeCheckout.html',
    'stripeCheckoutLoading.html',
    'accountDeletion.html',
    'index.html',
    'branding.html',
    'privacyPolicy.html',
    'advertise.html',
]);

const EXCLUDED_DIRS = [
    path.join('help', 'groups', '_template'),
];

function findHtmlFiles(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            results = results.concat(findHtmlFiles(fullPath));
        } else if (entry.name.endsWith('.html')) {
            results.push(fullPath);
        }
    }
    return results;
}

function isExcluded(filePath) {
    const relativePath = path.relative(ROOT, filePath);
    const fileName = path.basename(filePath);

    if (EXCLUDED_FILES.has(fileName)) return true;

    for (const excludedDir of EXCLUDED_DIRS) {
        if (relativePath.startsWith(excludedDir)) return true;
    }

    return false;
}

function removeFetchScriptBlock(html) {
    const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
    let result = html;
    let match;
    const replacements = [];

    while ((match = scriptRegex.exec(html)) !== null) {
        const scriptContent = match[1];
        const fullMatch = match[0];
        const startIndex = match.index;

        if (!scriptContent.includes("fetch('/header.html')") && !scriptContent.includes("fetch('/footer.html')")) {
            continue;
        }

        const cleaned = removeEmbedBlock(scriptContent);

        const meaningfulCode = cleaned
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .trim();

        if (meaningfulCode === '') {
            replacements.push({ from: fullMatch, to: '' });
        } else {
            replacements.push({ from: fullMatch, to: '<script>' + cleaned + '</script>' });
        }
    }

    for (const rep of replacements) {
        result = result.replace(rep.from, rep.to);
    }

    return result;
}

function findMatchingBrace(text, openPos) {
    let depth = 1;
    let i = openPos + 1;
    while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
    }
    return depth === 0 ? i - 1 : -1;
}

function removeEmbedBlock(scriptContent) {
    const embedStart = /\s*if\s*\(\s*!urlParams\.has\(\s*'embed'\s*\)\s*\)\s*\{/;
    let cleaned = scriptContent;

    const startMatch = cleaned.match(embedStart);
    if (!startMatch) {
        return removeFetchLines(cleaned);
    }

    const ifOpenBrace = startMatch.index + startMatch[0].length - 1;
    const ifCloseBrace = findMatchingBrace(cleaned, ifOpenBrace);
    if (ifCloseBrace === -1) {
        return removeFetchLines(cleaned);
    }

    const afterIf = cleaned.substring(ifCloseBrace + 1);
    const elseMatch = afterIf.match(/^\s*else\s*\{/);
    if (elseMatch) {
        const elseOpenBrace = ifCloseBrace + 1 + elseMatch[0].length - 1;
        const elseCloseBrace = findMatchingBrace(cleaned, elseOpenBrace);
        if (elseCloseBrace !== -1) {
            const blockStart = startMatch.index;
            const blockEnd = elseCloseBrace + 1;
            cleaned = cleaned.substring(0, blockStart) + '\n' + cleaned.substring(blockEnd);
        }
    } else {
        const blockStart = startMatch.index;
        const blockEnd = ifCloseBrace + 1;
        cleaned = cleaned.substring(0, blockStart) + '\n' + cleaned.substring(blockEnd);
    }

    return cleaned;
}

function removeFetchLines(scriptContent) {
    const headerFetchPattern = /\s*\/\/\s*Fetch and insert header\.html content\s*\n/g;
    let cleaned = scriptContent.replace(headerFetchPattern, '\n');

    const fetchBlockPattern = /\s*fetch\('\/header\.html'\)[\s\S]*?\.catch\(error\s*=>\s*console\.error\('Error loading header:',\s*error\)\);\s*/g;
    cleaned = cleaned.replace(fetchBlockPattern, '\n');

    const fetchBlockPattern2 = /\s*fetch\('\/header\.html'\)[\s\S]*?\.then\(data\s*=>\s*\{[\s\S]*?\}\);\s*/g;
    cleaned = cleaned.replace(fetchBlockPattern2, '\n');

    const footerFetchPattern = /\s*fetch\('\/footer\.html'\)[\s\S]*?\.catch\(error\s*=>\s*console\.error\('Error loading footer:',\s*error\)\);\s*/g;
    cleaned = cleaned.replace(footerFetchPattern, '\n');

    const footerFetchPattern2 = /\s*fetch\('\/footer\.html'\)[\s\S]*?\.then\(data\s*=>\s*\{[\s\S]*?\}\);\s*/g;
    cleaned = cleaned.replace(footerFetchPattern2, '\n');

    return cleaned;
}

function processFile(filePath) {
    let html = fs.readFileSync(filePath, 'utf8');

    const hasPlaceholder = html.includes('id="header-placeholder"');
    const hasInlinedNav = html.includes('id="mainNav"');

    if (!hasPlaceholder && !hasInlinedNav) {
        return false;
    }

    let modified = html;

    modified = modified.replace(
        /<!-- Dynamic header placeholder -->\n<div id="header-placeholder"><\/div>/g,
        headerNav
    );
    modified = modified.replace(
        /<div id="header-placeholder"><\/div>/g,
        headerNav
    );

    modified = modified.replace(NAV_BLOCK_REGEX, headerNav);

    // Ensure Google Analytics sits once in the <head>. The nav replacement above
    // has already stripped any stale body-level GA, so if the page now has no
    // gtag at all we add it high in the head. Guarded, so re-runs never duplicate.
    if (!modified.includes('googletagmanager.com/gtag/js')) {
        modified = modified.replace(/<head[^>]*>/, (headTag) => headTag + '\n' + GA_SNIPPET);
    }

    modified = modified.replace(
        /<div id="footer-placeholder"><\/div>/g,
        footerContent
    );

    modified = modified.replace(
        /<div style="margin-bottom: 200px;"><\/div>\s*<footer class="bg-black text-center py-5">[\s\S]*?<\/footer>/g,
        footerContent
    );

    modified = removeFetchScriptBlock(modified);

    if (!modified.includes('/css/nav.css')) {
        modified = modified.replace(
            /(<link[^>]*bootstrap[^>]*\.min\.css[^>]*>)/,
            '$1\n' + NAV_CSS_LINKS
        );
    }

    if (modified !== html) {
        fs.writeFileSync(filePath, modified, 'utf8');
        return true;
    }
    return false;
}

const allHtml = findHtmlFiles(ROOT);
const modifiedFiles = [];

for (const filePath of allHtml) {
    if (isExcluded(filePath)) continue;
    if (processFile(filePath)) {
        modifiedFiles.push(path.relative(ROOT, filePath));
    }
}

console.log(`\nBuild complete. Modified ${modifiedFiles.length} files:\n`);
modifiedFiles.forEach(f => console.log('  ' + f));
console.log('');
