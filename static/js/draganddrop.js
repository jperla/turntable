/*
 * Copyright (c) 2016  Joe Perla
 * All Rights Reserved.
 *
 * THE SOFTWARE IS PROVIDED "AS-IS" AND WITHOUT WARRANTY OF ANY KIND, 
 * EXPRESS, IMPLIED OR OTHERWISE, INCLUDING WITHOUT LIMITATION, ANY 
 * WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.  
 *
 * IN NO EVENT SHALL JOE PERLA BE LIABLE FOR ANY SPECIAL, INCIDENTAL,
 * INDIRECT OR CONSEQUENTIAL DAMAGES OF ANY KIND, OR ANY DAMAGES WHATSOEVER
 * RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER OR NOT ADVISED OF
 * THE POSSIBILITY OF DAMAGE, AND ON ANY THEORY OF LIABILITY, ARISING OUT
 * OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 */

var draganddrop = function(dropAreaId, songdb, dragOverCallback, metadataCallback) {
  var maxPercentLocalUpload = 80;

  var idOf = function(prefix,file) {
      return (prefix + file.name).replace(/[^a-z0-9]/gi,'')
  }

  var process_load = function(file, filename, callback) {
    console.log("load")

    var progressBar = $('#songprogress')
    progressBar.val(maxPercentLocalUpload)

    // store to local storage
    songdb.addSong(file,
                   {'source': 'local',
                    'temporary': false,
                    'originalName': filename,
                   },
      function(err, metadata) {
        if (err) {
          console.log('Could not upload that song')
          if (callback) {
            callback(err)
          }
        } else {
          songdb.addToHeadOfQueue('default', metadata.hash, function() {
            meshNode._debug("Did add song to queue: %s %o", metadata.hash, metadata)
            metadataCallback(metadata, function(err) {
              meshNode._debug("Error in metadata callback: %s %o", metadata.hash, metadata)
              if (callback) {
                callback(err)
              }
            })
          })
        }
    })
  }

  var handleDragOver = function(evt) {
    console.log(">>handleDragOver")
    evt.stopPropagation()
    evt.preventDefault()
    dragOverCallback()
  }

  var handleDrop = function(evt) {
    console.log(">>handleDrop")
    evt.stopPropagation()
    evt.preventDefault()

    var iterator = function(array, target, callback) {
      var i = 0
      var f
      f = function(err) {
        if (err) {
          console.log('Err on %i (%o): %s', i, array[i], err)
        }
        if (i >= array.length) {
          callback(null)
        } else {
          target(i, array[i], f)
          i += 1
        }
      }
      return f
    }

    var files = evt.dataTransfer.files
    console.log('Dropped: %i total', files.length)
    iterator(files, function(i, f, callback) {
      console.log('Dropped %i', i)
      if (f.type.match('audio.*')) {
        process_load(f, f.name, callback)
      } else {
        console.log(f.name + ' is not music: ' + f.type)
        alert("Must be music. Your upload is " + f.type)
        callback("Not an audio file")
      }
    }, function() {
      console.log('Done processing chunk of %i files', files.length)
    })()
  }

  var dropArea = document.getElementById(dropAreaId)
  dropArea.addEventListener('dragover', handleDragOver, false)
  dropArea.addEventListener('drop', handleDrop, false)
}
