function simplify(element) {
	const init = Symbol("init");

	const handler = {
		target: null,
		textContent: null,
		placeholders: null,

		init(target) {
			this.target = target;
			this.textContent = target.textContent;
			this.placeholders = this.textContent.match(/{{[a-z]*}}/g)
				.map(match => match.replaceAll(/({{)|(}})/g, ""));

			this.update();
		},
		update() {
			let textContent = this.textContent;
			this.placeholders.forEach(placeholder => {
				textContent = textContent.replace(`{{${placeholder}}}`, this[placeholder]);
			});
			this.target.textContent = textContent;
		},

		get(target, property, receiver) {
			if (property === init) {
				this.init(target);
				return;
			}

			for (let i = 0; i < this.placeholders.length; i++) {
				const placeholder = this.placeholders[i];
				if (property === placeholder) {
					return placeholder;
				}
			}

			const value = Reflect.get(...arguments);
			if (typeof(value) === "function") {
				return value.bind(target);
			} else {
				return value;
			}
		},
		set(target, property, value, receiver) {
			for (let i = 0; i < this.placeholders.length; i++) {
				if (property === this.placeholders[i]) {
					this[this.placeholders[i]] = value;

					this.update();

					return;
				}
			}

			Reflect.set(...arguments);
		},
	};

	const proxy = new Proxy(element, handler);
	proxy[init];
	return proxy;
}
