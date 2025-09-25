// Retain form values on page reload
(function () {
  const KEY = 'rssible-form';
  const form = document.querySelector('form');

  try {
    // Restore on page load
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const params = new URLSearchParams(saved);
      for (const [key, val] of params) {
        const elem = form.elements[key];
        if (!elem) continue;
        elem.value = val;
      }

      // Enable/disable mode-specific fields
      const mode = form.elements['mode'];
      mode && mode.dispatchEvent(new Event('change'));
    }
  } catch {}

  // Save on every change/input
  function save() {
    const params = new URLSearchParams();
    for (const elem of form.elements) {
      if (!elem.name) continue;
      const val = (elem.value || '').trim();
      if (val) params.set(elem.name, val);
    }

    try {
      localStorage.setItem(KEY, params.toString());
    } catch {
      console.log('Error saving form state');
    }
  }

  form.addEventListener('input', save, { passive: true });
})();

// Disable mode-specific fields when mode changes
(function () {
  const mode = document.getElementById('mode');

  const fullRow = document.getElementById('row-full-only');
  const descElem = fullRow.querySelector('[name="desc"]');
  const dateElem = fullRow.querySelector('[name="date"]');

  const advancedRow = document.getElementById('row-advanced-only');
  const headersElem = advancedRow.querySelector('[name="headers_text"]');
  const filtersElem = advancedRow.querySelector('[name="filters"]');

  function sync() {
    const isFull = mode.value === 'full';
    const isAdvanced = mode.value === 'advanced';

    descElem.disabled = !(isFull || isAdvanced);
    dateElem.disabled = !(isFull || isAdvanced);
    headersElem.disabled = !isAdvanced;
    filtersElem.disabled = !isAdvanced;

    // If disabled clear values
    if (descElem.disabled) descElem.value = '';
    if (dateElem.disabled) dateElem.value = '';
    if (headersElem.disabled) headersElem.value = '';
    if (filtersElem.disabled) filtersElem.value = '';
  }

  mode.addEventListener('change', sync);
  sync(); // sync on page load
})();


// Preview RSS feed with first two items
(function () {
  const previewBtn = document.getElementById('preview-btn');
  const previewBox = document.getElementById('preview');
  const previewCode = previewBox.querySelector('code');

  previewBtn.addEventListener('click', async function () {
    const previewUrl = window.buildFeedURL(2);
    const fullUrl = window.buildFeedURL();

    previewCode.textContent = 'Loading preview…';

    try {
      const res = await fetch(previewUrl);
      if (!res.ok) throw new Error(await res.text());
      const xml = await res.text();

      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const items = Array.from(doc.querySelectorAll('item')).slice(0, 2);

      const lines = items.map(it => {
        const title = it.querySelector('title')?.textContent?.trim() || '(empty)';
        const link = it.querySelector('link')?.textContent?.trim() || '(empty)';
        const desc = it.querySelector('description')?.textContent?.trim();
        const date = it.querySelector('pubDate')?.textContent?.trim();

        let block = `Title: ${title}\nLink: ${link}`;
        if (desc) block += `\nDesc: ${desc}`;
        if (date) block += `\nDate: ${date}`;
        return block;
      });

      const body = items.length //
        ? lines.join('\n\n') + '\n\n...' //
        : '// No items found.';

      previewCode.textContent = `Feed URL: ${fullUrl}\n\n${body}`;
    } catch (e) {
      previewCode.textContent = '// ' + (e.message || String(e) || 'Unknown error.');
    }
  });
})();

// Intercept form submit to copy the URL instead
(function () {
  const formElem = document.querySelector('form');
  const submitBtn = formElem.querySelector('button[type="submit"]');

  formElem.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = window.buildFeedURL();

    try {
      await navigator.clipboard.writeText(url.toString());
      const prev = submitBtn.textContent;
      submitBtn.textContent = 'Copied!';
      setTimeout(() => (submitBtn.textContent = prev), 1200);
    } catch {
      alert('Copy failed. You can copy it from the preview box.');
    }
  });

  window.buildFeedURL = function (limit) {
    const formData = new FormData(formElem);
    const params = new URLSearchParams();

    // Filter out params for transport
    for (const [key, val] of formData.entries()) {
      if (key === 'headers_text' || key === 'mode') continue;
      const normed = val.trim?.() ?? val;
      if (normed) params.set(key, normed);
    }

    // Override in preview mode
    if (limit != null) params.set('limit', String(limit));

    const url = new URL('/feed', location.href);
    url.search = params.toString();
    return url;
  }
})();

// Sync headers textarea with hidden base64 field
(function () {
  const advancedRow = document.getElementById('row-advanced-only');
  const headersText = advancedRow.querySelector('textarea[name="headers_text"]');
  const headersB64 = advancedRow.querySelector('input[name="headers"]');

  // base64-encoded for transport
  function encodeHeaders(raw) {
    return raw ? btoa(raw) : "";
  }

  // Keep hidden field in sync with textarea
  headersText.addEventListener('input', () => {
    headersB64.value = encodeHeaders(headersText.value.trim());
  });

  // Patch buildFeedURL so headers are always up-to-date
  const originalBuildFeedURL = window.buildFeedURL;
  window.buildFeedURL = function (limit) {
    headersB64.value = encodeHeaders(headersText.value.trim());
    return originalBuildFeedURL(limit);
  };
})();

// Invoke preview on demo link click
(function () {
  const formElem = document.querySelector('form');
  const modeElem = formElem.elements['mode'];
  const filtersElem = document.querySelector('#row-advanced-only [name="filters"]');
  const previewBtn = document.getElementById('preview-btn');

  function fill(config) {
    const mapping = {
      url: 'url', item: '_item', title: 'title', //
      link: 'link', desc: 'desc', date: 'date', //
      limit: 'limit'
    };

    // Clear all fields first
    for (const elem of formElem.elements) {
      if (elem.name) elem.value = '';
    }

    for (const [key, formName] of Object.entries(mapping)) {
      if (config[key]) formElem.elements[formName].value = config[key];
    }

    // Enable/disable mode-specific fields
    if (config.mode) {
      modeElem.value = config.mode;
      modeElem.dispatchEvent(new Event('change'));
    }

    // Now we can update mode-specific fields
    if (config.filters != null) {
      filtersElem.value = config.filters;
    }
  }

  document.querySelectorAll('#demos .demo').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      fill(JSON.parse(link.dataset.config));
      previewBtn.click();
    });
  });
})();
