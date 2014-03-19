#! /usr/bin/env node

require('string-format-js');
var execSync = require('execSync');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var _ = require('lodash');
var program = require('commander');
var fs = require('fs');
var spawn = require('child_process').spawn

program
.version('0.0.1')
.option('-p, --push', 'Push code if build is successful')
.usage('nag-build <build version number>')
.parse(process.argv);

if(!program.args[0]) {
  program.help();
}

var result;
var buildVersionNumber = program.args[0];
var temporaryDirectory = 'tmp-repositories';
var config = fs.readFileSync('nag-builder.json', 'ascii');
config = JSON.parse(config);
var repositories = config.repositories;

var tearDown = function() {
  rimraf.sync(temporaryDirectory);
};

var setup = function() {
  tearDown();
  mkdirp.sync(temporaryDirectory);

  process.chdir(temporaryDirectory);

  _.forEach(repositories, function(item) {
    result = execSync.exec('git clone ' + item.git);
    console.log(result.stdout);

    if(result.code !== 0) {
      throw Error('could not clone git repository: ' + result.stdout);
    }

    process.chdir(item.directory);

    console.log('installing npm and bower components')
    
    result = execSync.exec('npm install;bower install');

    if(result.code !== 0) {
      throw Error('could not install npm or bower components: ' + result.stdout);
    }

    console.log('npm and bower components installed');

    if(config.name) {
      console.log('configurating git user name');
    
      result = execSync.exec('git config --local user.name "%s"'.format(config.name));

      if(result.code !== 0) {
        throw Error('could not configure git user name: ' + result.stdout);
      }

      console.log('configured git user name');
    }

    if(config.email) {
      console.log('configurating git user email');
    
      result = execSync.exec('git config --local user.email "%s"'.format(config.email));

      if(result.code !== 0) {
        throw Error('could not configure git user email: ' + result.stdout);
      }

      console.log('configured git user email');
    }

    process.chdir('..');
  });

  process.chdir('..')
};

var runTests = function() {
  process.chdir(temporaryDirectory);

  _.forEach(repositories, function(item) {
    process.chdir(item.directory);

    if(item.testCommand) {
      console.log('running tests');

      if(item.testCommand === 'dalek') {
        var dalekWebSpawn = spawn('node', ['app-dev.js'], {
          cwd: process.cwd() + '/dalek-web/web',
          stdio: 'inherit'
        });
        result = execSync.exec(item.testCommand);
        dalekWebSpawn.kill();
      } else {
        result = execSync.exec(item.testCommand);
      }

      if(result.code !== 0) {
        throw Error('tests failed: ' + result.stdout);
      }

      console.log(result.stdout);
    }

    process.chdir('..');
  });

  process.chdir('..');
};

var updateRepositories = function() {
  var updateChangeLog = function() {
    if(fs.existsSync('CHANGELOG.md') === true) {
      var fileData = fs.readFileSync('CHANGELOG.md', 'ascii');
      
      if(fileData.indexOf('## master') !== -1) {
        fileData = fileData.replace('## master', '## %s'.format(buildVersionNumber));
        fs.writeFileSync('CHANGELOG.md', fileData, 'ascii');
      }
    }
  };

  process.chdir(temporaryDirectory);

  _.forEach(repositories, function(item) {
    process.chdir(item.directory);
    var oldDependencies, oldDevDependencies;

    //update the version number where is it store in the code
    if(fs.existsSync('bower.json') === true) {
      var jsonFile = fs.readFileSync('bower.json', 'ascii');
      var jsonObject = JSON.parse(jsonFile);
      jsonObject.version = buildVersionNumber;

      var dependenciesKeys = Object.keys(jsonObject.dependencies);
      var devDependenciesKeys = Object.keys(jsonObject.devDependencies);

      oldDependencies = _.clone(jsonObject.dependencies, true);
      oldDevDependencies = _.clone(jsonObject.devDependencies, true);

      //we also need to update and nucleus-angular-* dependencies since all nucleus-angular-* libraries are updated at the same time to the same version number
      if(dependenciesKeys.length > 0) {
        _.forEach(dependenciesKeys, function(key) {
          if(key.indexOf('nucleus-angular-') === 0) {
            jsonObject.dependencies[key] = buildVersionNumber;
          }
        });
      }

      if(devDependenciesKeys.length > 0) {
        _.forEach(devDependenciesKeys, function(key) {
          if(key.indexOf('nucleus-angular-') === 0) {
            jsonObject.devDependencies[key] = buildVersionNumber;
          }
        });
      }

      fs.writeFileSync('bower.json', JSON.stringify(jsonObject, null, '  '), 'ascii');
    }

    if(fs.existsSync('package.json') === true) {
      var jsonFile = fs.readFileSync('package.json', 'ascii');
      var jsonObject = JSON.parse(jsonFile);
      jsonObject.version = buildVersionNumber;
      fs.writeFileSync('package.json', JSON.stringify(jsonObject, null, '  '), 'ascii');
    }

    updateChangeLog();

    //need to commit the changes for the version numbers
    result = execSync.exec('git commit -a -m "releasing %s"'.format(buildVersionNumber));

    if(result.code !== 0) {
      throw Error('could not commit build version change: ' + result.stdout);
    }

    console.log('committed new build with command: ' + 'git commit -a -m "releasing %s"'.format(buildVersionNumber));

    //need to tag to new version number
    result = execSync.exec('git tag -a %s -m "Version %s"'.format(buildVersionNumber, buildVersionNumber));

    if(result.code !== 0) {
      throw Error('could not create git tag: ' + result.stdout);
    }

    console.log('tag created with command: ' + 'git tag -a %s -m "Version %s"'.format(buildVersionNumber, buildVersionNumber));

    //update dependencies to what they were for future development
    if(fs.existsSync('bower.json') === true) {
      var jsonFile = fs.readFileSync('bower.json', 'ascii');
      var jsonObject = JSON.parse(jsonFile);
      if(JSON.stringify(jsonObject.dependencies) !== JSON.stringify(oldDependencies) || JSON.stringify(jsonObject.devDependencies) !== JSON.stringify(oldDevDependencies)) {
        jsonObject.dependencies = oldDependencies;
        jsonObject.devDependencies = oldDevDependencies;
        fs.writeFileSync('bower.json', JSON.stringify(jsonObject, null, '  '), 'ascii');
        
        result = execSync.exec('git commit -a -m "update dependencies back for development"');

        if(result.code !== 0) {
          throw Error('could not commit build version change: ' + result.stdout);
        }

        console.log('committed new build with command: ' + 'git commit -a -m "update dependencies back for development"');
      }
    }

    process.chdir('..');
  });

  process.chdir('..');
};

var pushNewRelease = function() {
  process.chdir(temporaryDirectory);

  _.forEach(repositories, function(item) {
    process.chdir(item.directory);

    result = execSync.exec('git push origin master --tags');

    if(result.code !== 0) {
      throw Error('could not push new release: ' + result.stdout);
    }

    console.log('push new release with command: ' + 'git push origin master --tags');

    process.chdir('..');
  });

  process.chdir('..');
};

process.on('uncaughtException', function(error) {
  console.log(error);
  process.exit(1);
});

setup();
runTests();
updateRepositories();

if(program.push) {
  pushNewRelease();
  tearDown();
}

process.exit(0);