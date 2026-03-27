const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const headerNav = fs.readFileSync(path.join(ROOT, 'header-nav.html'), 'utf8');
const footerContent = fs.readFileSync(path.join(ROOT, 'footer-content.html'), 'utf8');

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

    modified = modified.replace(
        /<nav class="navbar navbar-expand-lg navbar-light fixed-top shadow-sm" id="mainNav">[\s\S]*?<\/nav>/g,
        headerNav
    );

    modified = modified.replace(
        /<div id="footer-placeholder"><\/div>/g,
        footerContent
    );

    modified = modified.replace(
        /<div style="margin-bottom: 200px;"><\/div>\s*<footer class="bg-black text-center py-5">[\s\S]*?<\/footer>/g,
        footerContent
    );

    modified = removeFetchScriptBlock(modified);

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
