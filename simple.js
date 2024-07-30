let simplify = null;

{
	const OTHER_KEYS = Symbol();
	const STRING_KEYS = Symbol();
	const OBJECT_KEYS = Symbol();
	const OBJECT_PROXYS = Symbol();
	const TEMPLATE_KEYS = Symbol();
	const TEMPLATE_PROXYS = Symbol();

	simplify = element => {
		const data = {};
		const tree = treeify(element, data);

		const handler = {
			get(target, property) {
				if (data[STRING_KEYS].has(property)) return data[property];
				if (data[OBJECT_KEYS].has(property)) return data[OBJECT_PROXYS].get(property);
				if (data[TEMPLATE_KEYS].has(property)) return data[TEMPLATE_PROXYS].get(property);

				const value = data[property];
				if (value !== undefined) {
					if (typeof value === "function") {
						return (...args) => {
							const before = JSON.stringify(data[key]);
							value.bind(data)(...args);
							if (before !== JSON.stringify(data[key])) {
								tree.updateObjects();
							}
						};
					} else {
						return value;
					}
				}

				return data[OTHER_KEYS][property];
			},
			set (target, property, value) {
				if (data[STRING_KEYS].has(property)) {
					data[property] = value;
					tree.updateStrings();
					return;
				}

				if (data[OBJECT_KEYS].has(property)) {
					data[property] = value;
					tree.updateObjects();
					return;
				}

				if (data[TEMPLATE_KEYS].has(property)) {
					data[property] = value;
					tree.updateTemplates();
					return;
				}

				if (data[property] !== undefined) {
					data[property] = value;
					return;
				}

				data[OTHER_KEYS][property] = value;
			},
		};

		return new Proxy({}, handler);
	}

	function treeify(element, data, root = true) {
		if (!data[OTHER_KEYS]) data[OTHER_KEYS] = {};
		if (!data[STRING_KEYS]) data[STRING_KEYS] = new Set();
		if (!data[OBJECT_KEYS]) data[OBJECT_KEYS] = new Map();
		if (!data[OBJECT_PROXYS]) data[OBJECT_PROXYS] = new Map();
		if (!data[TEMPLATE_KEYS]) data[TEMPLATE_KEYS] = new Set();
		if (!data[TEMPLATE_PROXYS]) data[TEMPLATE_PROXYS] = new Map();

		const childNodes = [...element.childNodes];
		const textNodes = childNodes.filter(node => node.nodeType === Node.TEXT_NODE);
		const elementNodes = childNodes.filter(node => node.nodeType === Node.ELEMENT_NODE);

		const strings = [];
		const objects = [];

		textNodes.map(node => {
			const content = node.textContent;

			const stringKeys = content.match(/{{[a-z0-9]+}}/g)
				?.map(match => match.replaceAll(/({{)|(}})/g, ""))
				|| [];
			if (stringKeys.length > 0) {
				stringKeys.forEach(key => data[STRING_KEYS].add(key));

				strings.push({
					node, content,
					keys: stringKeys,
					values: Array(stringKeys.length),
				});
			}

			const objectKeys = content.match(/{{[a-z0-9]+\.[a-z0-9]+}}/g)
				?.map(match => match.replaceAll(/({{)|(}})/g, ""))
				|| [];
			if (objectKeys.length > 0) {
				const keys = new Map();
				const jsons = new Map();

				objectKeys.forEach(objectKey => {
					const split = objectKey.split(".");
					const key = split[0];
					const subkey = split[1];

					if (!data[OBJECT_KEYS].has(key)) data[OBJECT_KEYS].set(key, new Set());
					data[OBJECT_KEYS].get(key).add(subkey);

					if (!keys.has(key)) keys.set(key, new Set());
					keys.get(key).add(subkey);

					if (!jsons.has(key)) jsons.set(key, new Set());
					jsons.get(key).add(JSON.stringify(data[key]));
				});

				objects.push({
					node, content,
					keys, jsons,
				});
			}
		});

		const templates = [];
		const subtrees = [];

		elementNodes.forEach(node => {
			if (node.nodeName !== "TEMPLATE") {
				subtrees.push(treeify(node, data, false));
				return;
			}

			const key = node.getAttribute("for");
			const end = document.createElement("span");
			node.after(end);

			const copys = new Map();

			data[TEMPLATE_KEYS].add(key);

			templates.push({
				node, end,
				key, copys,
			});
		});

		const tree = {
			element, data,
			strings, updateStrings,
			objects, updateObjects,
			templates, updateTemplates,
			subtrees,
		}

		data[OBJECT_KEYS].forEach((subkey, key) => createObjectProxy(tree, key));
		data[TEMPLATE_KEYS].forEach(key => createTemplateProxy(tree, key));

		if (root) {
			tree.updateStrings();
			tree.updateObjects();
			tree.updateTemplates();
		}

		return tree;
	}

	function createObjectProxy(tree, key) {
		const data = tree.data;
		const proxys = data[OBJECT_PROXYS];
		if (!data[key]) data[key] = {[OTHER_KEYS]: {}};

		const getTrap = (data, key, keys, target, property) => {
			const value = data[key][property];

			if (typeof value === "function") {
				return (...args) => {
					value.bind(data[key])(...args);
					tree.updateObjects();
				};
			} else if (typeof value === "object") {
				const subkeys = `${keys}/${property}`;

				if (proxys.has(subkeys)) {
					return proxys.get(subkeys);
				} else {
					const handler = {
						get: getTrap.bind(this, data[key], property, `${keys}/${property}`),
						set: setTrap.bind(this, data[key], property),
					};

					const proxy = new Proxy({}, handler);
					proxys.set(subkeys, proxy);
					return proxy;
				}
			} else {
				return value;
			}
		};

		const setTrap = (data, key, target, property, value) => {
			data[key][property] = value;
			tree.updateObjects();
		};

		const handler = {
			get: getTrap.bind(this, data, key, `/${key}`),
			set: setTrap.bind(this, data, key),
		};

		proxys.set(key, new Proxy({}, handler));
	}

	function createTemplateProxy(tree, key) {
		const data = tree.data;
		const proxys = data[TEMPLATE_PROXYS];
		if (!data[key]) {
			data[key] = [];
			data[key][OTHER_KEYS] = {};
		}

		const getTrap = (data, key, keys, target, property) => {
			const value = data[key][property];

			if (typeof value === "function") {
				return (...args) => {
					value.bind(data[key])(...args);
					tree.updateTemplates();
				};
			} else if (typeof value === "object") {
				const subkeys = `${keys}/${property}`;

				if (proxys.has(subkeys)) {
					return proxys.get(subkeys);
				} else {
					const handler = {
						get: getTrap.bind(this, data[key], property, `${keys}/${property}`),
						set: setTrap.bind(this, data[key], property),
					};

					const proxy = new Proxy({}, handler);
					proxys.set(subkeys, proxy);
					return proxy;
				}
			} else {
				return value;
			}
		};

		const setTrap = (data, key, target, property, value) => {
			data[key][property] = value;
			tree.updateTemplates();
		};

		const handler = {
			get: getTrap.bind(this, data, key, `/${key}`),
			set: setTrap.bind(this, data, key),
		};

		proxys.set(key, new Proxy({}, handler));
	}

	function updateStrings() {
		this.strings.forEach(string => {
			const data = this.data;
			const keys = string.keys;
			const values = string.values;

			let changed = false;
			for (let i = keys.length - 1; i >=0; i--) {
				if (data[keys[i]] !== values[i]) {
					values[i] = data[keys[i]];
					changed = true;
				}
			}
			if (!changed) return;

			let content = string.content;
			for (let i = keys.length - 1; i >=0; i--) {
				content = content.replaceAll(`{{${keys[i]}}}`, values[i]);
			}
			string.node.textContent = content;
		});

		this.subtrees.forEach(subtree => subtree.updateStrings());
	}

	function updateObjects() {
		this.objects.forEach(object => {
			const data = this.data;
			const keys = object.keys;
			const jsons = object.jsons;

			let changed = false;
			keys.forEach((subkey, key) => {
				const json = JSON.stringify(data[key]);
				if (json !== jsons.get(key)) {
					jsons.set(key, json);
					changed = true;
				}
			});
			if (!changed) return;

			let content = object.content;
			keys.forEach((subkeys, key) => {
				subkeys.forEach(subkey => {
					const value = data[key][subkey];
					content = content.replaceAll(new RegExp(`{{${key}\.${subkey}}}`, "g"), value);
				});
			});
			object.node.textContent = content;
		});

		this.subtrees.forEach(subtree => subtree.updateObjects());
	}

	function updateTemplates() {
		this.templates.forEach(template => {
			const data = this.data;
			const node = template.node;
			const end = template.end;
			const key = template.key;
			const copys = template.copys;

			const updated = new Set();

			data[key].forEach(item => {
				if (copys.has(item)) {
					const copy = copys.get(item);
					const json = JSON.stringify(item);

					if (json !== copy.json) {
						copy.tree.updateStrings();
						copy.tree.updateObjects();
						copy.tree.updateTemplates();
						copy.json = json;
					}
				} else {
					const element = node.content.firstElementChild.cloneNode(true);
					const tree = treeify(element, item);
					const json = JSON.stringify(item);
					end.before(element);

					copys.set(item, {tree, json});
				}

				updated.add(item);
			});

			copys.forEach((copy, item) => {
				if (updated.has(item)) return;

				copy.tree.element.remove();
				copys.delete(item);
			});
		});

		this.subtrees.forEach(subtree => subtree.updateTemplates());
	}
}
