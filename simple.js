function treeify(element, data) {
	const childNodes = [...element.childNodes];
	const textNodes = childNodes.filter(node => node.nodeType === Node.TEXT_NODE);
	const elementNodes = childNodes.filter(node => node.nodeType === Node.ELEMENT_NODE);

	const texts = textNodes.map(node => {
		const content = node.textContent;
		const placeholders = content.match(/{{[a-z0-9]+}}/g)
			?.map(match => match.replaceAll(/({{)|(}})/g, ""))
			|| [];

		if (placeholders.length === 0) return null;
		return {node, content, placeholders};
	})
		.filter(text => text !== null);

	const propertys = textNodes.map(node => {
		const content = node.textContent;
		const placeholders = new Map();
		content.match(/{{[a-z0-9]+\.[a-z0-9]+}}/g)
			?.map(match => match.replaceAll(/({{)|(}})/g, ""))
			?.forEach(match => {
				const split = match.split(".");
				const name = split[0];

				if (!data[name]) data[name] = {};
				if (!placeholders.has(name)) placeholders.set(name, []);
				const array = placeholders.get(name);
				array.push(split[1]);
			});

		if (placeholders.size === 0) return null;
		return {node, content, placeholders};
	})
		.filter(property => property !== null);

	const subtrees = elementNodes.map(element => treeify(element, data));

	return {element, texts, propertys, subtrees, data, replace, hasPlaceholder, findAllNamekeys};
}

function replace() {
	this.texts.forEach(text => {
		let textContent = text.content;

		text.placeholders.forEach(placeholder => {
			const value = this.data[placeholder] ?? undefined;
			textContent = textContent.replaceAll(`{{${placeholder}}}`, value);
		});

		text.node.textContent = textContent;
	});

	this.propertys.forEach(property => {
		let textContent = property.content;

		property.placeholders.forEach((keys, name) => {
			const object = this.data[name] ?? undefined;
			if (object === undefined) {
				textContent = textContent.replaceAll(new RegExp(`{{${name}\.[a-z0-9]+}}`, "g"), "undefined");
				return;
			}

			keys.forEach(key => {
				const value = object[key] ?? undefined;
				textContent = textContent.replaceAll(new RegExp(`{{${name}\.${key}}}`, "g"), value);
			});
		});

		property.node.textContent = textContent;
	});

	this.subtrees.forEach(subtree => subtree.replace());
}

function hasPlaceholder(placeholder) {
	for (const text of this.texts) {
		if(text.placeholders.includes(placeholder)) {
			return true;
		}
	}

	for (const property of this.propertys) {
		if (property.placeholders.has(placeholder)) {
			return true;
		}
	}

	for (const subtree of this.subtrees) {
		if (subtree.hasPlaceholder(placeholder)) {
			return true;
		}
	}

	return false;
}

function findAllNamekeys() {
	const namekeys = new Map();

	this.propertys.forEach(property => {
		property.placeholders.forEach((keys, name) => {
			if (!namekeys.has(name)) namekeys.set(name, []);
			namekeys.get(name).push(...keys);
		});
	});

	this.subtrees.forEach(subtree => {
		const subnamekeys = subtree.findAllNamekeys();
		subnamekeys.forEach((keys, name) => {
			if (!namekeys.has(name)) namekeys.set(name, []);
			namekeys.get(name).push(...keys);
		});
	});

	return namekeys;
}

function simplify(element) {
	const data = {};
	const tree = treeify(element, data);
	tree.replace();

	const namekeys = tree.findAllNamekeys();
	const namekeyProxys = new Map();
	namekeys.forEach((keys, name) => {
		const handler = {
			get(target, property, receiver) {
				if (keys.includes(property)) {
					return data[name][property];
				}

				const value = Reflect.get(...arguments);
				if (typeof(value) === "function") {
					return value.bind(target);
				} else {
					return value;
				}
			},
			set(target, property, value, receiver) {
				if (keys.includes(property)) {
					data[name][property] = value;
					tree.replace();
					return;
				}

				Reflect.set(...arguments);
			},
		}

		const proxy = new Proxy({}, handler);
		namekeyProxys.set(name, proxy);
	});

	const handler = {
		get(target, property, receiver) {
			if (namekeyProxys.has(property)) {
				return namekeyProxys.get(property);
			}

			if (tree.hasPlaceholder(property)) {
				return data[property];
			}

			const value = Reflect.get(...arguments);
			if (typeof(value) === "function") {
				return value.bind(target);
			} else {
				return value;
			}
		},
		set(target, property, value, receiver) {
			if (tree.hasPlaceholder(property)) {
				data[property] = value;
				tree.replace();
				return;
			}

			Reflect.set(...arguments);
		},
	};

	return new Proxy({}, handler);
}
