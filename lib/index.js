#! /usr/bin/env node

require('string-format-js');
var colors = require('colors');
var execSync = require('execSync');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var _ = require('lodash');
var program = require('commander');
var fs = require('fs');
var spawn = require('child_process').spawn;
var waitpid = require('waitpid');

program
.version('0.0.1')
.option('-p, --push', 'Push code if build is successful (or if --skip is used)')
.option('-s, --skip', 'Skip pulling latest code, running tests, and updating git repositories')
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

var syncChildProcess = function(command, arguments, options) {
  options = options || {};
  
  var cwd = options.cwd || process.cwd();
  var errorMessage = options.errorMessage || 'unknown error occured'
  var childProcess = spawn(command, arguments, {
    cwd: cwd,
    stdio: 'inherit'
  });

  var exitCode = waitpid(childProcess.pid).exitCode;

  if(exitCode !== 0) {
    throw Error(errorMessage);
  }

  childProcess.kill();
};

var tearDown = function() {
  rimraf.sync(temporaryDirectory);
};

var setup = function() {
  tearDown();
  mkdirp.sync(temporaryDirectory);

  process.chdir(temporaryDirectory);

  _.forEach(repositories, function(item) {
    console.log(('cloning: ' + item.git).green);

    syncChildProcess('git', ['clone', item.git], {errorMessage: 'could not clone git repository'});

    process.chdir(item.directory);

    if(fs.existsSync('package.json') === true) {
      syncChildProcess('npm', ['install'], {errorMessage: 'could not install npm components'});
    }

    if(fs.existsSync('bower.json') === true) {
      syncChildProcess('bower', ['install'], {errorMessage: 'could not install npm components'});
    }

    if(config.name) {
      syncChildProcess('git', ['config', '--local', 'user.name', config.name], {errorMessage: 'could not configure git user name'});
    }

    if(config.email) {
      syncChildProcess('git', ['config', '--local', 'user.email', config.email], {errorMessage: 'could not configure git user email'});
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
      console.log((item.directory + ': running tests').green);

      if(item.testCommand === 'dalek') {
        //this node application is required for the dalek test to run
        var dalekWebSpawn = spawn('node', ['app-dev.js'], {
          cwd: process.cwd() + '/dalek-web/web',
          stdio: 'ignore'
        });

        syncChildProcess(item.testCommand, [], {errorMessage: 'tests failed'});

        //need to make sure to kill the dalek web process so that the next test that needs to create one can
        dalekWebSpawn.kill();
      } else {
        var testArgs = item.testCommandArgs || [];
        syncChildProcess(item.testCommand, testArgs, {errorMessage: 'tests failed'});
      }
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
      console.log((item.directory + ': updating bower.json').green);

      var jsonFile = fs.readFileSync('bower.json', 'ascii');
      var jsonObject = JSON.parse(jsonFile);
      jsonObject.version = buildVersionNumber;

      //we also need to update and nucleus-angular-* dependencies since all nucleus-angular-* libraries are updated at the same time to the same version number
      if(jsonObject.dependencies) {
        var dependenciesKeys = Object.keys(jsonObject.dependencies);
        oldDependencies = _.clone(jsonObject.dependencies, true);

        if(dependenciesKeys.length > 0) {
          _.forEach(dependenciesKeys, function(key) {
            if(key.indexOf('nucleus-angular-') === 0) {
              jsonObject.dependencies[key] = buildVersionNumber;
            }
          });
        }
      }

      if(jsonObject.devDependencies) {
        var devDependenciesKeys = Object.keys(jsonObject.devDependencies);
        oldDevDependencies = _.clone(jsonObject.devDependencies, true);

        if(devDependenciesKeys.length > 0) {
          _.forEach(devDependenciesKeys, function(key) {
            if(key.indexOf('nucleus-angular-') === 0) {
              jsonObject.devDependencies[key] = buildVersionNumber;
            }
          });
        }
      }

      fs.writeFileSync('bower.json', JSON.stringify(jsonObject, null, '  '), 'ascii');
    }

    if(fs.existsSync('package.json') === true) {
      console.log((item.directory + ': updating package.json').green);

      var jsonFile = fs.readFileSync('package.json', 'ascii');
      var jsonObject = JSON.parse(jsonFile);
      jsonObject.version = buildVersionNumber;
      fs.writeFileSync('package.json', JSON.stringify(jsonObject, null, '  '), 'ascii');
    }

    updateChangeLog();

    //need to commit the changes for the version numbers
    console.log(('git commit -a -m "releasing %s"'.format(buildVersionNumber)).green);
    syncChildProcess('git', ['commit', '-a', '-m', '"releasing %s"'.format(buildVersionNumber)], {errorMessage: 'could not commit build version change'});

    //need to tag to new version number
    console.log(('git tag -a %s -m "Version %s"'.format(buildVersionNumber, buildVersionNumber)).green);
    syncChildProcess('git', ['tag', '-a', buildVersionNumber, '-m', '"Version %s"'.format(buildVersionNumber)], {errorMessage: 'could not create git tag'});

    //update dependencies to what they were for future development
    if(fs.existsSync('bower.json') === true) {
      var jsonFile = fs.readFileSync('bower.json', 'ascii');
      var jsonObject = JSON.parse(jsonFile);
      if(JSON.stringify(jsonObject.dependencies) !== JSON.stringify(oldDependencies) || JSON.stringify(jsonObject.devDependencies) !== JSON.stringify(oldDevDependencies)) {
        console.log((item.directory + ': resetting bower.json').green);
        jsonObject.dependencies = oldDependencies;
        jsonObject.devDependencies = oldDevDependencies;
        fs.writeFileSync('bower.json', JSON.stringify(jsonObject, null, '  '), 'ascii');

        console.log(('git commit -a -m "update dependencies back for development"').green);
        syncChildProcess('git', ['commit', '-a', '-m', '"update dependencies back for development"'], {errorMessage: 'could not commit build version change'});
      }
    }

    process.chdir('..');
  });

  process.chdir('..');
};

var pushNewRelease = function() {
  process.chdir(temporaryDirectory);

  _.forEach(repositories, function(item) {
    console.log(item.directory + ': committing code');

    process.chdir(item.directory);

    console.log(('git push origin master --tags').green);
    syncChildProcess('git', ['push', 'origin', 'master', '--tags'], {errorMessage: 'could not push new release'});

    process.chdir('..');
  });

  process.chdir('..');
};

process.on('uncaughtException', function(error) {
  console.log(error.toString().red);
  process.exit(1);
});

if(!program.skip) {
  setup();
  runTests();
  updateRepositories();
}

if(program.push) {
  pushNewRelease();
  tearDown();
}

process.exit(0);