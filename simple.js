function treeify(element) {
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

				if (!placeholders.has(name)) placeholders.set(name, []);
				const array = placeholders.get(name);
				array.push(split[1]);
			});

		if (placeholders.size === 0) return null;
		return {node, content, placeholders};
	})
		.filter(property => property !== null);

	const subtrees = elementNodes.map(element => treeify(element));

	return {element, texts, propertys, subtrees};
}

function replace(tree, data) {
	tree.texts.forEach(text => {
		let textContent = text.content;

		text.placeholders.forEach(placeholder => {
			const value = data[placeholder] ?? undefined;
			textContent = textContent.replaceAll(`{{${placeholder}}}`, value);
		});

		text.node.textContent = textContent;
	});

	tree.propertys.forEach(property => {
		let textContent = property.content;

		property.placeholders.forEach((keys, name) => {
			const object = data[name] ?? undefined;
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

	tree.subtrees.forEach(subtree => replace(subtree, data));
}

function hasPlaceholder(tree, placeholder) {
	for (const text of tree.texts) {
		if(text.placeholders.includes(placeholder)) {
			return true;
		}
	}

	for (const property of tree.propertys) {
		if (property.placeholders.has(placeholder)) {
			return true;
		}
	}

	for (const subtree of tree.subtrees) {
		if (hasPlaceholder(subtree, placeholder)) {
			return true;
		}
	}

	return false;
}

function simplify(element) {
	const tree = treeify(element);
	const data = {};
	replace(tree, data);

	const handler = {
		tree,
		data,

		get(target, property, receiver) {
			const value = Reflect.get(...arguments);
			if (typeof(value) === "function") {
				return value.bind(target);
			} else {
				return value;
			}
		},
		set(target, property, value, receiver) {
			if (hasPlaceholder(this.tree, property)) {
				this.data[property] = value;
				replace(this.tree, this.data);
				return;
			}

			Reflect.set(...arguments);
		},
	};

	return new Proxy(element, handler);
}
