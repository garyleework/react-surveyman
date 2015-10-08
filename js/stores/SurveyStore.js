var Reflux = require('reflux');
var initialData = require('../data.js');
var SurveyActions = require('../actions/SurveyActions');
var ItemTypes = require('../components/ItemTypes');
var Immutable = require('immutable');
var AlertTypes = require('../components/AlertTypes');
var Lockr = require('lockr');
// Replace when we update the surveyman module.
var SurveyMan = require('../sub/surveyman.js/SurveyMan/surveyman');
var {Survey, Block, Question} = SurveyMan.survey;

// a set of option texts - helps in generating suggestions
var _optionsSet = Immutable.OrderedSet();

// CONSTS
const ALERT_TIMEOUT = 5 * 1000; // toggles how quickly the alert hides
const LOCALSTORAGE_KEY = 'savedSurveyList'; // the key against which the survey data is stored in LS

// mananging history
var _history = [];

var SurveyStore = Reflux.createStore({
  listenables: [SurveyActions],
  data: {
    surveyData: SurveyMan.new_survey(),
    modalState: Immutable.Map({
      dropTargetID: null,
      isOpen: false
    }),
    loadSurveyModalState: false,
    savedSurveys: [],
    alertState: Immutable.Map({
      msg: '',
      level: AlertTypes.INFO,
      visible: false
    }),
    optionGroupState: Immutable.Map({
      selectedID: 1,
      options: Immutable.List()
    })
  },
  // called when the app component is loaded
  init() {
    let default_options = [
      ["Yes", "No"],
      ["True", "False"],
      ["Strongly Disagree", "Disagree", "Neither agree or disagree", "Agree", "Strongly Agree"]
    ];
    var initOptionsData = Immutable.fromJS([
      { id: 0, optionLabels: default_options[0], option: SurveyMan.new_option(default_options[0], this.getNewId(ItemTypes.OPTION))},
      { id: 1, optionLabels: default_options[1], option: SurveyMan.new_option(default_options[1], this.getNewId(ItemTypes.OPTION))},
      { id: 2, optionLabels: default_options[2], option: SurveyMan.new_option(default_options[2], this.getNewId(ItemTypes.OPTION))}
    ]);

    this.listenTo(SurveyActions.load, () => {
      window.location.hash = "";   // clear the location hash on app init
      this.data.optionGroupState = this.data.optionGroupState.set('options', initOptionsData);
      // read the saved survey data
      this.data.savedSurveys = Lockr.get(LOCALSTORAGE_KEY) || [];
      // load up survey data
      console.assert(initialData !== undefined);
      var data = new Survey(initialData);
      this.updateSurveyData(data, true);
    });
  },
  getInitialState() {
    return {
      surveyData: this.data.surveyData,
      modalState: this.data.modalState,
      alertState: this.data.alertState,
      optionGroupState: this.data.optionGroupState,
      loadSurveyModalState: this.data.loadSurveyModalState,
      savedSurveys: this.data.savedSurveys
    };
  },
  /**
   * Updates the survey data as the args provided. Triggers refresh.
   * Stores prev state in history, if second param is true
   * @param {SurveyMan.survey.Survey} data surveydata
   * @param cache - boolean
   */
  updateSurveyData(data, cache = false) {
    if (cache) {
      _history.push({
        data: this.data.surveyData
      });
    }
    this.data.surveyData = data;
    this.trigger(this.data);
  },
  /*
   * Returns the set (unique list) of options.
   */
  getOptionsSet() {
    return _optionsSet;
  },
  /*
   * Returns the surveyjson data
   */
  getSurveyData() {
    return this.data.surveyData.toJSON();
  },
  /**
   * Returns the id of the block which has the
   * question with questionId
   * @param questionId
   */
  getBlockId(questionId) {
    let survey = this.data.surveyData;
    let question = survey.get_question_by_id(questionId);
    return question.block.id;
  },
  /**
   * Returns a new ID based on the type of object requested
   * @param type one of ItemTypes.OPTION, ItemTypes.BLOCK, ItemTypes.QUESTION
   */
  getNewId(type) {
    var prefix;
    if (type === ItemTypes.QUESTION) {
      prefix = "q";
    } else if (type === ItemTypes.OPTION) {
      prefix = "o";
    } else {
      prefix = "b";
    }
    return `${prefix}_${Math.floor((Math.random() * 99999) + 1)}`;
  },
  /**
   * Runs when the blockDropped action is called by the view.
   * Adds a new block to the end of the survey object.
   * @param targetID: targetId of the target on which the block is dropped.
   * If this is undefined, then block is assumed to have dropped on the survey
   */
  onBlockDropped(targetID) {
    var survey = this.data.surveyData;
    var newBlock = SurveyMan.new_block(this.getNewId(ItemTypes.BLOCK));
    if (targetID === undefined) {
      let newSurvey = SurveyMan.add_block(survey, newBlock, null, false);
      this.updateSurveyData(newSurvey, true);
      SurveyActions.showAlert("New block added.", AlertTypes.SUCCESS);
    } else {
      try {
        let newSurvey = SurveyMan.add_block(survey, newBlock, survey.get_block_by_id(targetID), false);
        this.updateSurveyData(newSurvey, true);
      } catch (e) { console.log('Error in SurveyStore.onBlockDropped', e); return; }
      SurveyActions.showAlert("New subblock added.", AlertTypes.SUCCESS);
    }
  },
  /**
   * Runs when the optiongroup is dropped on a question
   * @param questionId - ID of the question on which
   * the option group is dropped
   */
  onOptionGroupDropped(questionId) {
    var selectedID = this.data.optionGroupState.get('selectedID');
    var optionLabels = this.data.optionGroupState
        .getIn(['options', selectedID, 'optionLabels']);
    optionLabels.forEach(op => this.onOptionAdded(questionId, op));
  },
  /**
   * Runs when the questionDropped action is called by the view.
   * Adds a question to the block whose id is provided as param
   * @param questionObj A POJO containing data the for the new question.
   * with the following keys - parentID, qtext, config
   */
  onQuestionDropped(questionObj) {
    let survey = this.data.surveyData;
    questionObj.id = this.getNewId(ItemTypes.QUESTION);
    let question = new Question(questionObj);
    let block = survey.get_block_by_id(questionObj.parentID);
    try {
      let newSurvey = SurveyMan.add_question(question, block, survey, false);
      // update and cache
      this.updateSurveyData(newSurvey, true);
      SurveyActions.showAlert("New Question added.", AlertTypes.SUCCESS);
    } catch (e) { console.warn(e); }
  },
  /**
   * Runs when the optionAdded action is called by the view.
   * Adds an option with text as otext to the question whose id is provided as an argument.
   * @param questionId (int) of the question to which the option will be added.
   * @param otext (string) the text of the option to be added
   */
  onOptionAdded(questionId, otext) {
    var survey = this.data.surveyData;
    var newOption = SurveyMan.new_option(otext);
    var question = survey.get_question_by_id(questionId);
    var newSurvey = SurveyMan.add_option(newOption, question, survey, false);
    this.updateSurveyData(newSurvey, true);

    // update the option map and options set
    _optionsSet = _optionsSet.add(otext);
  },
  /**
   * Run when the action toggleModal is called by the view
   * @param modalType - Refer to the type of object that was dropped
   * @param dropTargetID - Refers to the ID on which the object was dropped
   */
  onToggleModal(modalType, dropTargetID) {
    var modalState = this.data.modalState;
    // TODO: this handles the modal for question separately, although this is not really required. Deal with it later.
    if (modalType === ItemTypes.QUESTION) {
      modalState = modalState.set('isOpen', !modalState.get('isOpen'));
    }
    // sets the correct dropTarget to pass down to component
    this.data.modalState = modalState.set('dropTargetID', dropTargetID);
    this.trigger(this.data);
  },
  /**
   * Run when the action showAlert is called. Responsible for displaying
   * alert in the app
   * @param msg - the msg to be displayed
   * @param level - the level. defaults to 'info'. See Bootstrap alerts for more.
   */
  onShowAlert(msg, level=AlertTypes.INFO) {
    this.data.alertState = Immutable.Map({
        msg: msg,
        level: level,
        visible: true
    });
    this.trigger(this.data);

    // Hides the alert box
    setTimeout(function(self) {
        self.data.alertState = self.data.alertState.set('visible', false);
        self.trigger(self.data);
    }, ALERT_TIMEOUT, this);
  },
  /**
   * Called when the clearSurvey action is called.
   * Clears up the existing survey state, takes a copy and allows the user
   * to start afresh.
   */
  onClearSurvey() {
    console.assert(initialData !== undefined);
    var data = new Survey(initialData);
    this.updateSurveyData(data, true);
    SurveyActions.showAlert("New survey created", AlertTypes.SUCCESS);

    _optionsSet = Immutable.OrderedSet();
  },
  /**
   * Called when the saveSurvey action is called.
   * Stores a snapshot of the survey JSON object in the localStorage.
   */
  onSaveSurvey(surveyTitle) {
    var newSurvey = {
        title: surveyTitle,
        data: this.data.surveyData.toJSON(),
        createdAt: Date.now()
    };
    var savedSurveys = Lockr.get(LOCALSTORAGE_KEY) || [];
    Lockr.set(LOCALSTORAGE_KEY, savedSurveys.concat([newSurvey]));
    // update the cached survey data to include the latest
    this.data.savedSurveys = Lockr.get(LOCALSTORAGE_KEY);
    SurveyActions.showAlert("Survey saved!", AlertTypes.INFO);
  },
  /**
   * Called when the loadSurvey action is triggered.
   * Takes the survey json as param and loads that into the application state.
   * @param rawData survey data in json
   */
  onLoadSurvey(rawData) {
    console.assert(rawData !== undefined, 'survey json data should be defined');
    // update the survey object
    var data = new Survey(rawData);
    this.updateSurveyData(data, true);
    SurveyActions.showAlert("Survey loaded.", AlertTypes.SUCCESS);
  },
  /**
   * Called when the toggleLoadModal action is triggered.
   * Toggles the visibility of the load survey modal.
   */
  onToggleLoadModal() {
    this.data.loadSurveyModalState = !this.data.loadSurveyModalState;
    console.log('triggering onToggleLoadModal');
    this.trigger(this.data);
  },
  /**
   * Takes a block and runs over its children recursively and
   * populates the maps (option, question, block) with correct mappings
   * @param block - Block of type Immutable.Map
   */
  buildMapsForBlock(block) {
    let blockId = block.id;
    // handle subblocks
    block.subblocks.forEach((b) => {
      _blockMap = _blockMap.set(b.id, blockId);
      this.buildMapsForBlock(b);
    });
  },
  /**
   * Returns an array of indices that can be directly go in first arguments to
   * Immutable deep persistent functions.
   * @param blockId - id of the block who's index is required
   * @param parentBlock (optional) - The parent block at which to begin the
   * search. If left out, the search starts from the top of the survey within
   * the `parentBlock`
   */
  getBlockIndex(blockId, parentBlock = false) {
    // find in the survey
    if (!parentBlock) {
        return this.data.surveyData.topLevelBlocks.findIndex(b => b.id === blockId);
    } else {
      return parentBlock.subblocks.findIndex(b => b.id === blockId);
    }
  },
  /**
   * Returns the index of a question in a block
   * @param questionId - id of the question
   * @param {SurveyMan.survey.Block} block - obj (Immutable.Map) of the container block
   */
  getQuestionIndex(questionId, block) {
    return block.topLevelQuestions.findIndex(q => q.id === questionId);
  },
  /**
   * Called when the toggleParam action is called.
   * Toggles the property on the item.
   * @param itemType - type of Item the toggle button is clicked. one of ItemTypes
   * @param itemId - Id of the item for which toggle button is clicked
   * @param toggleName - string name of property that is toggled.
   */
  onToggleParam(itemType, itemId, toggleName) {
    var survey = this.data.surveyData;

    if (itemType === ItemTypes.BLOCK) {
      let oldBlock = survey.get_block_by_id(itemId);
      let newBlock = SurveyMan.copy_block(oldBlock);
      console.log(toggleName);
      switch (toggleName) {
        case 'randomizable':
          newBlock.randomizable = !newBlock.randomizable;
      }
      let newSurvey = SurveyMan.remove_block(oldBlock, survey, false);
      newSurvey.add_block(survey, newBlock);
     this.updateSurveyData(newSurvey);
    }

    // handle the case when a param on a question is toggled
    else if (itemType === ItemTypes.QUESTION) {
      let oldQuestion = survey.get_question_by_id(itemId);
      let block = oldQuestion.block;
      let newQuestion = SurveyMan.copy_question(oldQuestion);
      switch(toggleName) {
        case 'exclusive':
          newQuestion.exclusive = !newQuestion.exclusive;
          break;
        case 'ordered':
          newQuestion.ordered = !newQuestion.ordered;
          break;
        case 'freetext':
          newQuestion.freetext = !newQuestion.freetext;
          break;
      }
      let newSurvey = SurveyMan.remove_question(oldQuestion, survey, false);
      SurveyMan.add_question(newQuestion, block, newSurvey);
      this.updateSurveyData(newSurvey);
    }
    // throw exception
    else {
        throw new Error("Not a valid item type");
    }
  },
  /**
   * Returns a clone of Question passed as a parameter.
   * @param question - type of Immutable.Map. The question to be cloned
   */
  cloneQuestion(question) {
    return SurveyMan.copy_question(question);
  },
  /**
   * Returns a clone of Block passed as a parameter.
   * Updates _blockMap and _questionMap with the new subblocks and questions
   * @param block - type of Immutable.Map. The block to be cloned.
   */
  cloneBlock(block) {
    return SurveyMan.copy_block(block);
  },
  /**
   * Method called when the itemCopy action is triggered.
   * Responsible for creating a new copy of an ItemType - works only for
   * question and block.
   * @param itemType type of ItemType
   * @param itemId id of the item to be cloned
   */
  onItemCopy(itemType, itemId) {
    var survey = this.data.surveyData;

    if (itemType === ItemTypes.BLOCK) {
      let oldBlock = survey.get_block_by_id(itemId);
      let newBlock = SurveyMan.copy_block(oldBlock);
      newBlock.id = this.getNewId(ItemTypes.BLOCK);
      let newSurvey = SurveyMan.add_block(survey, newBlock, newBlock.parent, false);
      this.updateSurveyData(newSurvey, false);

      // alert and focus
      SurveyActions.showAlert("Block copied.", AlertTypes.INFO);
      SurveyActions.scrollToItem(newBlock.id);
    }

    else if (itemType === ItemTypes.QUESTION) {
      let oldQuestion = survey.get_question_by_id(itemId);
      let newQuestion = SurveyMan.copy_question(oldQuestion);
      newQuestion.id = this.getNewId(ItemTypes.QUESTION);
      let newSurvey = SurveyMan.add_question(newQuestion, oldQuestion.block, survey, false);
      // update and cache
      this.updateSurveyData(newSurvey, false);
      // alert and focus
      SurveyActions.showAlert("Question copied.", AlertTypes.INFO);
      SurveyActions.scrollToItem(newQuestion.id);
    }

    else {
        throw new Error("Not a valid item type");
    }
  },
  /**
   * Called when an item has to be deleted.
   * @param itemType - refers to the type of item to be deleted. One of ItemTypes.
   * @param itemId - Id of item to be deleted.
   */
  onItemDelete(itemType, itemId) {
    var survey = this.data.surveyData;
    // handle block delete
    if (itemType === ItemTypes.BLOCK) {
      let block = survey.get_block_by_id(itemId);
      let newSurvey = SurveyMan.remove_block(block, survey, false);
      this.updateSurveyData(newSurvey, true);
      SurveyActions.showAlert("Block deleted successfully.", AlertTypes.SUCCESS);
    }

    // handle question delete
    else if (itemType === ItemTypes.QUESTION) {
      let question = survey.get_question_by_id(itemId);
      let newSurvey = SurveyMan.remove_question(question, survey, false);
      // update and cache
      this.updateSurveyData(newSurvey, true);
      SurveyActions.showAlert("Question deleted successfully.", AlertTypes.SUCCESS);
    }

    // handle option delete
    else if (itemType === ItemTypes.OPTION) {
      let option = survey.get_option_by_id(itemId);
      let newSurvey = SurveyMan.remove_option(option, survey, null, false);
      this.updateSurveyData(newSurvey, true);
      SurveyActions.showAlert("Options deleted successfully.", AlertTypes.SUCCESS);
    }
    // throw exception
    else {
      throw new Error("Not a valid item type");
    }
  },
  /**
   * Called when the question text is edited. Sets qtext to new value.
   * @param text - new text value
   * @param questionId - id of the question that needs to be changed
   */
  onSaveEditText(text, questionId) {
    var survey = this.data.surveyData;
    var oldQuestion = survey.get_question_by_id(questionId);
    var newQuestion = SurveyMan.copy_question(oldQuestion);
    newQuestion.qtext = text;
    let newSurvey = SurveyMan.replace_question(newQuestion);
    this.updateSurveyData(newSurvey, true);
  },
  /**
   * Used to tag on a string value of freeText to a question
   * @param text The value of freetext
   * @param questionId Id of the question to which the freetext prop should be added
   */
  onSaveFreeText(text, questionId) {
    var survey = this.data.surveyData;
    let newSurvey = SurveyMan.copy_survey(survey);
    var newQuestion = SurveyMan.copy_question(survey.get_question_by_id(questionId));
    // TODO(etosch): test whether this sets default and regex correctly.
    newQuestion.setFreetext(text);
    newSurvey.replace_question(newQuestion);
    this.updateSurveyData(newSurvey, true);
  },
  /**
   * Called when the undoSurvey action is triggered. Responsible for
   * setting global state to last _history item.
   */
  onUndoSurvey() {
    // hide the alert
    this.data.alertState = this.data.alertState.set('visible', false);
    // retrieve cached data
    var { data } = _history.pop();
    this.updateSurveyData(data);
  },
  /**
   * Called when the scrolltoItem action is triggered. Scrolls the item
   * into view
   * @param id - id of the item that needs to be scrolled to
   */
  onScrollToItem(id) {
    window.location.hash = id;
  },
  // called when a new optiongroup is selected as the default in the optionlist selectbox
  onUpdateOptionGroup(id) {
    this.data.optionGroupState = this.data.optionGroupState.set('selectedID', id);
    this.trigger(this.data);
  },
  /**
   * @param options - array of options
   */
  onAddOptionGroup(options) {
    var { optionGroupState } = this.data;
    var newId = optionGroupState.get('options').count();
    this.data.optionGroupState = optionGroupState
        .set('selectedID', newId)
        .updateIn(['options'], list => list.push(
            Immutable.Map({id: newId, optionLabels: options})
        ));
    this.trigger(this.data);
  },
  onMoveQuestion(questionID, blockID) {
    let survey = this.data.surveyData;
    let question = survey.get_question_by_id(questionID);
    let currBlock = question.block;
    var currBlockID = currBlock.id;
    // if the question is dropped in the same block then do nothing
    if (currBlockID === blockID) {
      return;
    }
    // update and cache
    let newSurvey = SurveyMan.remove_question(question, survey, false);
    SurveyMan.add_question(question, block, newSurvey);
    this.updateSurveyData(newSurvey, true);
    SurveyActions.showAlert("Question moved.", AlertTypes.SUCCESS);
  },
  /**
   * Called when an item is dragged to be re-ordered in the treeview.
   * This works on the assumption that the item is ordered within its parent container.
   * @param draggedItemId: id of the block being dragged
   * @param finalIndex: final location where the item needs to be moved to within the container
   */
  onReorderItem(draggedItemId, finalIndex, itemType) {
    // TODO: test this -- what happens when you drag an item into a region not on the appropriate level?
    var survey = this.data.surveyData;

    if (itemType === ItemTypes.BLOCK) {
      // TODO: find out where finalIndex is coming from.
      console.warn('Draggable reordering not yet implemented.');
    }
    else if (itemType === ItemTypes.QUESTION) {
      // TODO: same
      console.warn('Draggable reordering not yet implemented.');
    }
    else {
      throw 'Invalid item type';
    }
  }
});

module.exports = SurveyStore;