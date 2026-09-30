// Lists scene files in order. `?scenes=s01,s02` renders only those (fast component tests).
(function () {
  const only = new URLSearchParams(location.search).get('scenes');
  const list = ['s01'].filter((s) => !only || only.split(',').includes(s));
  for (const s of list) document.write(`<script src="scenes/${s}.js"><\/script>`);
})();
