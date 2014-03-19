# Nucleus Angular Builder

This tool is used to build releases for the components for Nucleus Angular.  This tool is only useful to users with access to the Nucleus Angular repositories as it provide an automated way to push updated versions of the components.

Since we want to manage each components in separate repositories (so that users can pick an choose which components to use) but we don't want to have to manage the version numbers of each repository independently (the overhead would be way to high), this tool will:

* pull down all the Nucleus Angular repositories
* install the npm and bower components
* run the Karma or DalekJS tests for each repository
* update the version numbers in the bower.json, package.json, and CHANGELOG.md files, also update version numbers for any nucleus-angular-* dependency in the bower.json for each repository (and commit)
* tag the version number for each repository
* revert the version numbers for any nucleus-angular-* dependency in the bower.json back to master for development (and commit)
* push to new commits/tags for each repository

If any step fails, the process exit before pushing any code to the remote repository.
