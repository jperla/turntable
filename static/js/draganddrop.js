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
  var maxPercentLocalUpload = 100;

  var idOf = function(prefix,file) {
      return (prefix + file.name).replace(/[^a-z0-9]/gi,'')
  }

  // FileReader event handlers
  var fr = (function() {
      return {
          loadStart: function(file) {
              return function(e) {
                  console.log("loadStart: "+e)

                  var uploading = $("<div></div>")
                  uploading.addClass("thumbnail")
                  uploading.append('<span>'+file.name+'</span><br /><img id="'+idOf('img',file)+'" src=""><br /><progress id="'+idOf('pg',file)+'" value="0" max="100"></progress>')
                  $('#upload-status').append(uploading)
              }
          },
          progress: function(file) {
              return function(e) {
                  console.log("progress")

                  var progressBar = $('#'+idOf('pg',file))

                  if (e.lengthComputable) {
                      var loaded = (e.loaded / e.total)
                      console.log(e.loaded + '/' + e.total + '/' + loaded)
                      if (loaded < 1) {
                          progressBar.val(loaded * maxPercentLocalUpload)
                      }
                  } else {
                      console.log("not lengthComputable")
                      progressBar.val(maxPercentLocalUpload)
                  }
              }
          },
          load: function(file) {
              return function(e) {
                  console.log("load")

                  var progressBar = $('#'+idOf('pg',file))
                  progressBar.val(maxPercentLocalUpload)

                  // store to local storage
                  songdb.addSong(e.target.result, function(err, metadata) {
                    if (err) {
                      console.log('Could not upload that song')
                    }

                    var id3 = metadata.id3
                    metadataCallback(metadata)
                  })
              }
          },
      }
  })()

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

      var files = evt.dataTransfer.files
      for (var i = 0, f; f = files[i]; i++) {
          if (!f.type.match('audio.*')) {
              console.log(f.name+' is not music: '+f.type )
              alert("must be music. your upload is "+f.type)
              continue
          }

          var reader = new FileReader()
          reader.onloadstart = fr.loadStart(f)
          reader.onprogress  = fr.progress(f)
          reader.onload      = fr.load(f)
          reader.readAsDataURL(f)
      }
  }

  var dropArea = document.getElementById(dropAreaId)
  dropArea.addEventListener('dragover', handleDragOver, false)
  dropArea.addEventListener('drop', handleDrop, false)
}
