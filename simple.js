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
								tree.updateTexts();
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
					tree.updateTexts();
					return;
				}

				if (data[OBJECT_KEYS].has(property)) {
					data[property] = value;
					tree.updateTexts();
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

		const attributeNodes = [...element.attributes];
		const childNodes = [...element.childNodes];
		const textNodes = childNodes.filter(node => node.nodeType === Node.TEXT_NODE);
		const elementNodes = childNodes.filter(node => node.nodeType === Node.ELEMENT_NODE);

		const texts = [];

		[...attributeNodes, ...textNodes].forEach(node => {
			const content = node.textContent;

			const values = new Map();

			const strings = content.match(/{{[a-z0-9]+}}/g)
				?.map(match => match.replaceAll(/({{)|(}})/g, ""))
				|| [];

			strings.forEach(key => {
				data[STRING_KEYS].add(key);
				values.set(key, undefined);
			});

			const objectKeys = content.match(/{{([a-z0-9]+\.)+[a-z0-9]+}}/g)
				?.map(match => match.replaceAll(/({{)|(}})/g, ""))
				|| [];

			const objects = new Map();

			objectKeys.forEach(objectKey => {
				const split = objectKey.split(".");
				const key = split.shift();
				const subkey = split.join(".");

				if (!data[OBJECT_KEYS].has(key)) data[OBJECT_KEYS].set(key, new Set());
				data[OBJECT_KEYS].get(key).add(subkey);

				if (!objects.has(key)) objects.set(key, new Set());
				objects.get(key).add(subkey);

				values.set(objectKey, undefined);
			});

			texts.push({
				node, content,
				strings, objects, values,
			});
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
			texts, updateTexts,
			templates, updateTemplates,
			subtrees,
		}

		data[OBJECT_KEYS].forEach((subkey, key) => createObjectProxy(tree, key));
		data[TEMPLATE_KEYS].forEach(key => createTemplateProxy(tree, key));

		if (root) {
			tree.updateTexts();
			tree.updateTemplates();
		}

		return tree;
	}

	function createObjectProxy(tree, key) {
		const data = tree.data;
		const subkeys = data[OBJECT_KEYS].get(key);
		const proxys = data[OBJECT_PROXYS];
		if (!data[key]) {
			data[key] = {[OTHER_KEYS]: {}};
			subkeys.forEach(subkey => {
				const split = subkey.split(".");

				if (split.length === 1) {
					if (data[subkey]) data[subkey] = undefined;
					return;
				}

				let target = data[key];
				const last = split.pop();
				for (let i = 0; i < split.length; i++) {
					target[split[i]] = {[OTHER_KEYS]: {}};
					target = target[split[i]];
				}
				target[last] = undefined;
			});
		}

		const getTrap = (data, key, keys, target, property) => {
			const value = data[key][property];

			if (typeof value === "function") {
				return (...args) => {
					value.bind(data[key])(...args);
					tree.updateTexts();
				};
			} else if (typeof value === "object") {
				const subkeys = `${keys}.${property}`;

				if (proxys.has(subkeys)) {
					return proxys.get(subkeys);
				} else {
					const handler = {
						get: getTrap.bind(this, data[key], property, subkeys),
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
			tree.updateTexts();
		};

		const handler = {
			get: getTrap.bind(this, data, key, key),
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
				const subkeys = `${keys}.${property}`;

				if (proxys.has(subkeys)) {
					return proxys.get(subkeys);
				} else {
					const handler = {
						get: getTrap.bind(this, data[key], property, subkeys),
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
			get: getTrap.bind(this, data, key, key),
			set: setTrap.bind(this, data, key),
		};

		proxys.set(key, new Proxy({}, handler));
	}

	function updateTexts() {
		this.texts.forEach(text => {
			const data = this.data;
			const strings = text.strings;
			const objects = text.objects;
			const values = text.values;

			let changed = false;

			strings.forEach(key => {
				const value = data[key];
				if (values.get(key) !== value) {
					values.set(key, value);
					changed = true;
				}
			});

			objects.forEach((subkeys, key) => {
				subkeys.forEach(subkey => {
					const split = subkey.split(".");

					let value;
					if (split.length === 1) {
						value = data[key][subkey];
					} else {
						let target = data[key];
						const last = split.pop();

						for (let i = 0; i < split.length; i++) {
							target = target[split[i]];
						}

						value = target[last];
					}

					const valuekey = `${key}.${subkey}`;
					if (values.get(valuekey) !== value) {
						values.set(valuekey, value);
						changed = true;
					}
				});
			});

			if (!changed) return;

			let content = text.content;

			strings.forEach(key => {
				content = content.replaceAll(`{{${key}}}`, values.get(key));
			});

			objects.forEach((subkeys, key) => {
				subkeys.forEach(subkey => {
					const valuekey = `${key}.${subkey}`;
					content = content.replaceAll(`{{${valuekey}}}`, values.get(valuekey));
				});
			});

			text.node.textContent = content;
		});

		this.subtrees.forEach(subtree => subtree.updateTexts());
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
					copy.updateTexts();
					copy.updateTemplates();
				} else {
					const element = node.content.firstElementChild.cloneNode(true);
					const tree = treeify(element, item);
					end.before(element);

					copys.set(item, tree);
				}

				updated.add(item);
			});

			copys.forEach((copy, item) => {
				if (updated.has(item)) return;

				copy.element.remove();
				copys.delete(item);
			});
		});

		this.subtrees.forEach(subtree => subtree.updateTemplates());
	}
}
