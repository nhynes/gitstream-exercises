#!/usr/bin/env node

'use strict'

var utils = require('./utils'),
    fs = require('fs'),
    path = require('path'),
    esprima = require('esprima'),
    escodegen = require('escodegen'),
    ast = require('./ast'),
    q = require('q'),

    SRC_DIR = path.join( __dirname, 'src' ),
    EXERCISES_DIR = path.join( SRC_DIR, 'exercises' ),
    STARTER_REPO_DIR = path.join( SRC_DIR, 'starter_repo' ),
    REPO_TMP = path.join( STARTER_REPO_DIR, 'template' ),
    REPO_CONTENTS = path.join( STARTER_REPO_DIR, 'contents' ),
    RESOURCES_DIR_NAME = 'resources',

    GEN_DIR = path.join( __dirname, 'exercises' ),
    REPO_DIR_NAME = 'starting.git',
    MACHINES_FILE = path.join( __dirname, 'machines.js' ),
    VIEWERS_FILE = path.join( __dirname, 'viewers.js' ),
    REPOS_FILE = path.join( __dirname, 'repos.js' ),

    ANGLER_URL = 'http://localhost/hooks'

function createNewRepo( repoDir ) {
    var git = utils.git.bind.bind( utils.git, null, repoDir )

    return utils.cp( REPO_CONTENTS, repoDir )
    .then( utils.git.bind( null, __dirname, 'init', [ '--template=' + REPO_TMP, repoDir ] ) )
    .then( git( 'config', [ 'angler.url', ANGLER_URL ] ) )
    .then( git( 'config', [ 'receive.denyCurrentBranch', 'false' ] ) )
    .then( git( 'add', ':/' ) )
}

function createExerciseDir( exercise ) {
    // copy the exercise resources into the output dir
    var resourcesDir = path.join( EXERCISES_DIR, exercise, RESOURCES_DIR_NAME ),
        exerciseName = exercise.substring( exercise.indexOf('-') + 1 ),
        outputDir = path.join( GEN_DIR, exerciseName ),
        repoPath = path.join( outputDir, REPO_DIR_NAME ),

        pending = [
            q.nfcall( fs.stat, resourcesDir )
            .then( utils.cp.bind( null, resourcesDir, outputDir ), function() { /* noop */ } ),
            createNewRepo( repoPath )
        ]

    return q.all( pending )
}

// npm replaces all .gitignores with .npmignores on install. fix this.
function replaceNPMIgnores( src ) {
    return q.nfcall( fs.stat, src )
    .then( function( stats ) {
        if ( stats.isDirectory() ) {
            return q.nfcall( fs.readdir, src )
            .then( function( files ) {
                return q.all( files.map( function( file ) {
                    return replaceNPMIgnores( path.join( src, file ) )
                }) )
            })
        } else if ( path.basename( src ) === '.npmignore' ) {
            return q.nfcall( fs.rename, src, path.join( path.dirname( src ), '.gitignore' ) )
        }
    })
}

replaceNPMIgnores( SRC_DIR )
.then( utils.getExercises )
.done( function( exerciseConfs ) {
    return q.nfcall( fs.mkdir, GEN_DIR )
    .done( function() {
        var exercises = Object.keys( exerciseConfs ),
            order = ast.createArray( exercises.sort().map( function( exercise ) {
                if ( /^[0-9]+-/.test( exercise ) ) { // hide unordered exercises
                    return ast.createLiteral( exercise.substring( exercise.indexOf('-') + 1 ) )
                }
            }).filter( function( name ) { return !!name } ) ),
            machines = [],
            viewers = [ ast.createProperty( '_order', order ) ],
            repos = [],
            outputDir

        // split the configs
        exercises.forEach( function( exercise ) {
            var exerciseName = exercise.substring( exercise.indexOf('-') + 1 ),
                exerciseConf = require( exerciseConfs[ exercise ].path ),
                confAst = esprima.parse( exerciseConfs[ exercise ].data ),
                combinedScopeExprs = ast.getCombinedScopeExprs( confAst ),
                confTrees = ast.getConfSubtrees( confAst )

            // make the output directory
            outputDir = path.join( GEN_DIR, exerciseName )
            q.nfcall( fs.mkdir, outputDir )
            .done( createExerciseDir.bind( null, exercise, exerciseConf ) )

            function mkConfSubmodule( confAst ) {
                var submodule = ast.createSubmodule( combinedScopeExprs, confAst )
                return ast.createProperty( exerciseName, submodule )
            }

            machines.push( mkConfSubmodule( confTrees.machine ) )
            viewers.push( mkConfSubmodule( confTrees.viewer ) )
            repos.push( mkConfSubmodule( confTrees.repo || ast.createObject([]) ) )
        })

        function writeMod( file, props ) {
            var mod = ast.createModule( null, ast.createObject( props ) )
            fs.writeFile( file, escodegen.generate( mod ) )
        }

        // write out the split configs
        writeMod( MACHINES_FILE, machines )
        writeMod( VIEWERS_FILE, viewers )
        writeMod( REPOS_FILE, repos )
    })
})
