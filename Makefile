.PHONY: build test format
build:
	npm run format-check
	npm run build
	npm run package
test:
	npm test
format:
	npm run format