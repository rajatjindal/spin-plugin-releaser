# Spin Plugin Releaser

`spin-plugin-releaser` is a GitHub action (backed by a [Spin app](https://github.com/rajatjindal/spin-plugin-release-bot) deployed on Fermyon Cloud) that automates the update of plugin manifests in spin-plugins repo when a new version of your spin plugin is released. If a release is marked as a 'prerelease' in github, it will not be released to the spin-plugins index.

To trigger `spin-plugin-releaser` you can use a github-action which sends the event to the bot.

# Basic Setup

- Make sure you have enabled github actions for your repo
- Add a `.spin-plugin.json.tmpl` template file at the root of your repo. Refer to [cloud-plugin](https://github.com/fermyon/cloud-plugin) repo for an example.

- To setup the action, add the following snippet after the step that publishes the new release and assets:
  ```yaml
  - name: Update new version in spin plugins repo
    uses: rajatjindal/spin-plugin-releaser@main
    with:
      github_token: ${{ secrets.GITHUB_TOKEN }}
      upload_checksums: true
  ```

# Inputs for the action

| Key                | Default Value          | Description                                                                          |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------ |
| template_file | `.spin-plugin.json.tmpl`           | The path to template file |
| upload_checksums | false           | uploads the checksums-<tagname>.txt file to the release |

# Limitations of spin-plugin-releaser

- only works for repos hosted on github right now
- The first version of plugin has to be submitted manually, by plugin author, to the spin-plugins repo
