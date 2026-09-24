// Та самая терракотовая копилка
export const PIG_SVG = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
<defs>
<radialGradient id="pgb" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffc093"/><stop offset=".45" stop-color="#e8733a"/><stop offset=".85" stop-color="#a8431a"/><stop offset="1" stop-color="#6e2508"/></radialGradient>
<radialGradient id="pgs" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ffcfaa"/><stop offset=".6" stop-color="#e2743d"/><stop offset="1" stop-color="#9a3b14"/></radialGradient>
<linearGradient id="pgl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9642c"/><stop offset="1" stop-color="#8a3210"/></linearGradient>
<radialGradient id="pgc" cx="40%" cy="35%" r="65%"><stop offset="0" stop-color="#fff3b0"/><stop offset=".6" stop-color="#f3c23a"/><stop offset="1" stop-color="#b8860b"/></radialGradient>
</defs>
<ellipse cx="102" cy="170" rx="70" ry="9" fill="#000" opacity=".45"/>
<rect x="56" y="128" width="21" height="38" rx="9" fill="#9b3a12"/>
<rect x="118" y="128" width="21" height="38" rx="9" fill="#9b3a12"/>
<rect x="71" y="134" width="21" height="34" rx="9" fill="url(#pgl)"/>
<rect x="134" y="134" width="21" height="34" rx="9" fill="url(#pgl)"/>
<path d="M36 98 q-18 -4 -13 -18 q6 -9 13 1" stroke="#b64d1d" stroke-width="5" fill="none" stroke-linecap="round"/>
<ellipse cx="100" cy="102" rx="68" ry="52" fill="url(#pgb)"/>
<path d="M118 60 l12 -27 l15 29 z" fill="#b24a1c"/>
<path d="M121 58 l9 -19 l10 20 z" fill="#f29a6a"/>
<path d="M100 57 l5 -24 l15 24 z" fill="#d0602a"/>
<ellipse cx="165" cy="106" rx="15" ry="19" fill="url(#pgs)"/>
<ellipse cx="161" cy="102" rx="2.8" ry="4.5" fill="#6b2208"/>
<ellipse cx="170" cy="102" rx="2.8" ry="4.5" fill="#6b2208"/>
<circle cx="139" cy="84" r="5.5" fill="#1f0a02"/>
<circle cx="140.8" cy="82.2" r="1.8" fill="#fff"/>
<rect x="80" y="57" width="36" height="7" rx="3.5" fill="#4a1604"/>
<ellipse cx="78" cy="78" rx="30" ry="14" fill="#fff" opacity=".22" transform="rotate(-12 78 78)"/>
<circle cx="98" cy="36" r="15" fill="url(#pgc)" stroke="#a87408" stroke-width="2.5"/>
<text x="98" y="42" font-size="16" text-anchor="middle" font-weight="bold" font-family="Helvetica, Arial" fill="#8a5e00">₽</text>
</svg>`;

export function pigEl(cls = 'pig') {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = PIG_SVG;
  d.firstChild.setAttribute('width', '100%');
  d.firstChild.setAttribute('height', '100%');
  return d;
}
