function treeify(element) {
	const childNodes = [...element.childNodes];
	const textNodes = childNodes.filter(node => node.nodeType === Node.TEXT_NODE);
	const elementNodes = childNodes.filter(node => node.nodeType === Node.ELEMENT_NODE);

	const texts = textNodes.map(node => {
		const content = node.textContent;
		const placeholders = content.match(/{{[a-z0-9]*}}/g)
			?.map(match => match.replaceAll(/({{)|(}})/g, ""))
			|| [];
		return {node, content, placeholders};
	});

	const subtrees = elementNodes.map(element => treeify(element));

	return {element, texts, subtrees};
}

function replace(tree, data) {
	tree.texts.forEach(text => {
		let textContent = text.content;

		text.placeholders.forEach(placeholder => {
			const value = data[placeholder] ?? undefined;
			textContent = text.content.replaceAll(`{{${placeholder}}}`, value);
		});

		text.node.textContent = textContent;
	});

	tree.subtrees.forEach(subtree => replace(subtree, data));
}

function hasPlaceholder(tree, placeholder) {
	for (const text of tree.texts) {
		if(text.placeholders.includes(placeholder)) {
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
