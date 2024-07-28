let simplify = null;

{
	const OTHER_KEYS = Symbol();
	const STRING_KEYS = Symbol();
	const OBJECT_KEYS = Symbol();
	const OBJECT_PROXYS = Symbol();

	simplify = element => {
		const data = {
			[OTHER_KEYS]: {},
			[STRING_KEYS]: new Set(),
			[OBJECT_KEYS]: new Map(),
			[OBJECT_PROXYS]: new Map(),
		};
		const tree = treeify(element, data);

		const handler = {
			get(target, property) {
				if (data[STRING_KEYS].has(property)) return data[property];
				if (data[OBJECT_KEYS].has(property)) return data[OBJECT_PROXYS].get(property);

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

				if (data[property] !== undefined) {
					data[property] = value;

					return;
				}

				data[OTHER_KEYS][property] = value;
			},
		};

		return new Proxy({}, handler);
	}

	function treeify(element, data) {
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

		const subtrees = elementNodes.map(element => treeify(element, data));

		const tree = {
			element, data,
			strings, updateStrings,
			objects, updateObjects,
			subtrees,
		}

		data[OBJECT_KEYS].forEach((subkey, key) => {
			data[key] = {[OTHER_KEYS]: {}};
			data[OBJECT_PROXYS].set(key, createObjectProxy(tree, key));
		});

		tree.updateStrings();
		tree.updateObjects();
		return tree;
	}

	function createObjectProxy(tree, key) {
		const data = tree.data;

		const handler = {
			get(target, property) {
				if (data[OBJECT_KEYS].get(key).has(property)) {
					return data[key][property];
				}

				const value = data[key][property];
				if (value !== undefined) {
					if (typeof value === "function") {
						return (...args) => {
							const before = JSON.stringify(data[key]);
							value.bind(data[key])(...args);
							if (before !== JSON.stringify(data[key])) {
								tree.updateObjects();
							}
						};
					} else {
						return value;
					}
				}

				return data[key][OTHER_KEYS][property];
			},
			set(target, property, value) {
				if (data[OBJECT_KEYS].get(key).has(property)) {
					data[key][property] = value;
					tree.updateObjects();

					return;
				}

				if (data[key][property] !== undefined) {
					data[key][property] = value;

					return;
				}

				data[key][OTHER_KEYS][property] = value;
			},
		};

		return new Proxy({}, handler);
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
}
