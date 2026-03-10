const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'front/src/components/LLMConfig.tsx');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/:bg-\[#252525\]/g, '');
content = content.replace(/:text-\[var\(--text-muted\)\]/g, '');
content = content.replace(/:text-\[var\(--text-secondary\)\]/g, '');
content = content.replace(/:text-\[var\(--text-primary\)\]/g, '');
content = content.replace(/:bg-\[var\(--bg-overlay\)\]/g, '');
content = content.replace(/:bg-\[var\(--bg-tertiary\)\]/g, '');
content = content.replace(/:border-\[var\(--border-strong\)\]/g, '');

fs.writeFileSync(filePath, content);
console.log('Done');
