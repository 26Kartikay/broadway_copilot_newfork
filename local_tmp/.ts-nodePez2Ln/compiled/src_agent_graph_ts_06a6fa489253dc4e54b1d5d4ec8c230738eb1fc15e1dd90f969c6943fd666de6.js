"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAgentGraph = buildAgentGraph;
const client_1 = require("@prisma/client");
const graph_1 = require("../lib/graph");
const logger_1 = require("../utils/logger");
const nodes_1 = require("./nodes");
function buildAgentGraph() {
    const graph = new graph_1.StateGraph()
        .addNode('ingestMessage', nodes_1.ingestMessage)
        .addNode('recordUserInfo', nodes_1.recordUserInfo)
        .addNode('routeIntent', nodes_1.routeIntent)
        .addNode('routeGeneral', nodes_1.routeGeneral)
        .addNode('askUserInfo', nodes_1.askUserInfo)
        .addNode('handleStyling', nodes_1.handleStyling)
        .addNode('handleFeedback', nodes_1.handleFeedback)
        .addNode('vibeCheck', nodes_1.vibeCheck)
        .addNode('colorAnalysis', nodes_1.colorAnalysis)
        .addNode('handleGeneral', nodes_1.handleGeneral)
        .addNode('sendReply', nodes_1.sendReply)
        .addNode('routeStyling', nodes_1.routeStyling)
        .addNode('handleStyleStudio', nodes_1.handleStyleStudio)
        .addNode('dailyFact', nodes_1.dailyFact)
        .addEdge(graph_1.START, 'ingestMessage')
        .addConditionalEdges('ingestMessage', (s) => {
        if (s.pending === client_1.PendingType.ASK_USER_INFO) {
            return 'recordUserInfo';
        }
        if (s.pending === client_1.PendingType.FEEDBACK) {
            return 'handleFeedback';
        }
        return 'routeIntent';
    }, {
        recordUserInfo: 'recordUserInfo',
        handleFeedback: 'handleFeedback',
        routeIntent: 'routeIntent',
    })
        .addEdge('recordUserInfo', 'routeIntent')
        .addConditionalEdges('routeIntent', (s) => {
        if (s.missingProfileField) {
            return 'askUserInfo';
        }
        return s.intent || 'general';
    }, {
        askUserInfo: 'askUserInfo',
        general: 'routeGeneral',
        vibe_check: 'vibeCheck',
        color_analysis: 'colorAnalysis',
        style_studio: 'handleStyleStudio',
    })
        .addEdge('routeGeneral', 'handleGeneral')
        .addConditionalEdges('routeStyling', (s) => {
        if (s.assistantReply) {
            return 'sendReply';
        }
        if (s.stylingIntent) {
            return 'handleStyling';
        }
        logger_1.logger.warn({ userId: s.user.id }, 'Exiting styling flow unexpectedly, routing to general');
        return 'routeGeneral';
    }, {
        handleStyling: 'handleStyling',
        routeGeneral: 'routeGeneral',
        sendReply: 'sendReply',
    })
        .addEdge('vibeCheck', 'sendReply')
        .addEdge('askUserInfo', 'sendReply')
        .addEdge('handleStyleStudio', 'sendReply')
        .addEdge('colorAnalysis', 'sendReply')
        .addEdge('handleGeneral', 'sendReply')
        .addEdge('handleFeedback', 'sendReply')
        .addEdge('sendReply', graph_1.END);
    return graph.compile();
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ncmFwaC50cyIsInNvdXJjZXMiOlsiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ncmFwaC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQXFCQSwwQ0FtRkM7QUF4R0QsMkNBQTZDO0FBQzdDLHdDQUFzRDtBQUN0RCw0Q0FBeUM7QUFDekMsbUNBZWlCO0FBR2pCLFNBQWdCLGVBQWU7SUFDN0IsTUFBTSxLQUFLLEdBQUcsSUFBSSxrQkFBVSxFQUFjO1NBQ3ZDLE9BQU8sQ0FBQyxlQUFlLEVBQUUscUJBQWEsQ0FBQztTQUN2QyxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsc0JBQWMsQ0FBQztTQUN6QyxPQUFPLENBQUMsYUFBYSxFQUFFLG1CQUFXLENBQUM7U0FDbkMsT0FBTyxDQUFDLGNBQWMsRUFBRSxvQkFBWSxDQUFDO1NBQ3JDLE9BQU8sQ0FBQyxhQUFhLEVBQUUsbUJBQVcsQ0FBQztTQUNuQyxPQUFPLENBQUMsZUFBZSxFQUFFLHFCQUFhLENBQUM7U0FDdkMsT0FBTyxDQUFDLGdCQUFnQixFQUFFLHNCQUFjLENBQUM7U0FDekMsT0FBTyxDQUFDLFdBQVcsRUFBRSxpQkFBUyxDQUFDO1NBQy9CLE9BQU8sQ0FBQyxlQUFlLEVBQUUscUJBQWEsQ0FBQztTQUN2QyxPQUFPLENBQUMsZUFBZSxFQUFFLHFCQUFhLENBQUM7U0FDdkMsT0FBTyxDQUFDLFdBQVcsRUFBRSxpQkFBUyxDQUFDO1NBQy9CLE9BQU8sQ0FBQyxjQUFjLEVBQUUsb0JBQVksQ0FBQztTQUNyQyxPQUFPLENBQUMsbUJBQW1CLEVBQUUseUJBQWlCLENBQUM7U0FDL0MsT0FBTyxDQUFDLFdBQVcsRUFBRSxpQkFBUyxDQUFDO1NBQy9CLE9BQU8sQ0FBQyxhQUFLLEVBQUUsZUFBZSxDQUFDO1NBQy9CLG1CQUFtQixDQUNsQixlQUFlLEVBQ2YsQ0FBQyxDQUFhLEVBQUUsRUFBRTtRQUNoQixJQUFJLENBQUMsQ0FBQyxPQUFPLEtBQUssb0JBQVcsQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUM1QyxPQUFPLGdCQUFnQixDQUFDO1FBQzFCLENBQUM7UUFDRCxJQUFJLENBQUMsQ0FBQyxPQUFPLEtBQUssb0JBQVcsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUN2QyxPQUFPLGdCQUFnQixDQUFDO1FBQzFCLENBQUM7UUFDRCxPQUFPLGFBQWEsQ0FBQztJQUN2QixDQUFDLEVBQ0Q7UUFDRSxjQUFjLEVBQUUsZ0JBQWdCO1FBQ2hDLGNBQWMsRUFBRSxnQkFBZ0I7UUFDaEMsV0FBVyxFQUFFLGFBQWE7S0FDM0IsQ0FDRjtTQUNBLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxhQUFhLENBQUM7U0FDeEMsbUJBQW1CLENBQ2xCLGFBQWEsRUFDYixDQUFDLENBQWEsRUFBRSxFQUFFO1FBQ2hCLElBQUksQ0FBQyxDQUFDLG1CQUFtQixFQUFFLENBQUM7WUFDMUIsT0FBTyxhQUFhLENBQUM7UUFDdkIsQ0FBQztRQUNELE9BQU8sQ0FBQyxDQUFDLE1BQU0sSUFBSSxTQUFTLENBQUM7SUFDL0IsQ0FBQyxFQUNEO1FBQ0UsV0FBVyxFQUFFLGFBQWE7UUFDMUIsT0FBTyxFQUFFLGNBQWM7UUFDdkIsVUFBVSxFQUFFLFdBQVc7UUFDdkIsY0FBYyxFQUFFLGVBQWU7UUFFL0IsWUFBWSxFQUFFLG1CQUFtQjtLQUNsQyxDQUNGO1NBQ0EsT0FBTyxDQUFDLGNBQWMsRUFBRSxlQUFlLENBQUM7U0FDeEMsbUJBQW1CLENBQ2xCLGNBQWMsRUFDZCxDQUFDLENBQWEsRUFBRSxFQUFFO1FBR2hCLElBQUksQ0FBQyxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3JCLE9BQU8sV0FBVyxDQUFDO1FBQ3JCLENBQUM7UUFDRCxJQUFJLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNwQixPQUFPLGVBQWUsQ0FBQztRQUN6QixDQUFDO1FBQ0QsZUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFFLHVEQUF1RCxDQUFDLENBQUM7UUFDNUYsT0FBTyxjQUFjLENBQUM7SUFDeEIsQ0FBQyxFQUNEO1FBQ0UsYUFBYSxFQUFFLGVBQWU7UUFDOUIsWUFBWSxFQUFFLGNBQWM7UUFDNUIsU0FBUyxFQUFFLFdBQVc7S0FDdkIsQ0FDRjtTQUNBLE9BQU8sQ0FBQyxXQUFXLEVBQUUsV0FBVyxDQUFDO1NBQ2pDLE9BQU8sQ0FBQyxhQUFhLEVBQUUsV0FBVyxDQUFDO1NBQ25DLE9BQU8sQ0FBQyxtQkFBbUIsRUFBRSxXQUFXLENBQUM7U0FFekMsT0FBTyxDQUFDLGVBQWUsRUFBRSxXQUFXLENBQUM7U0FDckMsT0FBTyxDQUFDLGVBQWUsRUFBRSxXQUFXLENBQUM7U0FDckMsT0FBTyxDQUFDLGdCQUFnQixFQUFFLFdBQVcsQ0FBQztTQUN0QyxPQUFPLENBQUMsV0FBVyxFQUFFLFdBQUcsQ0FBQyxDQUFDO0lBRTdCLE9BQU8sS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO0FBQ3pCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQZW5kaW5nVHlwZSB9IGZyb20gJ0BwcmlzbWEvY2xpZW50JztcbmltcG9ydCB7IEVORCwgU1RBUlQsIFN0YXRlR3JhcGggfSBmcm9tICcuLi9saWIvZ3JhcGgnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vdXRpbHMvbG9nZ2VyJztcbmltcG9ydCB7XG4gIGFza1VzZXJJbmZvLFxuICBjb2xvckFuYWx5c2lzLFxuICBkYWlseUZhY3QsXG4gIGhhbmRsZUZlZWRiYWNrLFxuICBoYW5kbGVHZW5lcmFsLFxuICBoYW5kbGVTdHlsZVN0dWRpbyxcbiAgaGFuZGxlU3R5bGluZyxcbiAgaW5nZXN0TWVzc2FnZSxcbiAgcmVjb3JkVXNlckluZm8sXG4gIHJvdXRlR2VuZXJhbCxcbiAgcm91dGVJbnRlbnQsXG4gIHJvdXRlU3R5bGluZyxcbiAgc2VuZFJlcGx5LFxuICB2aWJlQ2hlY2ssXG59IGZyb20gJy4vbm9kZXMnO1xuaW1wb3J0IHsgR3JhcGhTdGF0ZSB9IGZyb20gJy4vc3RhdGUnO1xuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRBZ2VudEdyYXBoKCkge1xuICBjb25zdCBncmFwaCA9IG5ldyBTdGF0ZUdyYXBoPEdyYXBoU3RhdGU+KClcbiAgICAuYWRkTm9kZSgnaW5nZXN0TWVzc2FnZScsIGluZ2VzdE1lc3NhZ2UpXG4gICAgLmFkZE5vZGUoJ3JlY29yZFVzZXJJbmZvJywgcmVjb3JkVXNlckluZm8pXG4gICAgLmFkZE5vZGUoJ3JvdXRlSW50ZW50Jywgcm91dGVJbnRlbnQpXG4gICAgLmFkZE5vZGUoJ3JvdXRlR2VuZXJhbCcsIHJvdXRlR2VuZXJhbClcbiAgICAuYWRkTm9kZSgnYXNrVXNlckluZm8nLCBhc2tVc2VySW5mbylcbiAgICAuYWRkTm9kZSgnaGFuZGxlU3R5bGluZycsIGhhbmRsZVN0eWxpbmcpXG4gICAgLmFkZE5vZGUoJ2hhbmRsZUZlZWRiYWNrJywgaGFuZGxlRmVlZGJhY2spXG4gICAgLmFkZE5vZGUoJ3ZpYmVDaGVjaycsIHZpYmVDaGVjaylcbiAgICAuYWRkTm9kZSgnY29sb3JBbmFseXNpcycsIGNvbG9yQW5hbHlzaXMpXG4gICAgLmFkZE5vZGUoJ2hhbmRsZUdlbmVyYWwnLCBoYW5kbGVHZW5lcmFsKVxuICAgIC5hZGROb2RlKCdzZW5kUmVwbHknLCBzZW5kUmVwbHkpXG4gICAgLmFkZE5vZGUoJ3JvdXRlU3R5bGluZycsIHJvdXRlU3R5bGluZylcbiAgICAuYWRkTm9kZSgnaGFuZGxlU3R5bGVTdHVkaW8nLCBoYW5kbGVTdHlsZVN0dWRpbylcbiAgICAuYWRkTm9kZSgnZGFpbHlGYWN0JywgZGFpbHlGYWN0KVxuICAgIC5hZGRFZGdlKFNUQVJULCAnaW5nZXN0TWVzc2FnZScpXG4gICAgLmFkZENvbmRpdGlvbmFsRWRnZXMoXG4gICAgICAnaW5nZXN0TWVzc2FnZScsXG4gICAgICAoczogR3JhcGhTdGF0ZSkgPT4ge1xuICAgICAgICBpZiAocy5wZW5kaW5nID09PSBQZW5kaW5nVHlwZS5BU0tfVVNFUl9JTkZPKSB7XG4gICAgICAgICAgcmV0dXJuICdyZWNvcmRVc2VySW5mbyc7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHMucGVuZGluZyA9PT0gUGVuZGluZ1R5cGUuRkVFREJBQ0spIHtcbiAgICAgICAgICByZXR1cm4gJ2hhbmRsZUZlZWRiYWNrJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ3JvdXRlSW50ZW50JztcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHJlY29yZFVzZXJJbmZvOiAncmVjb3JkVXNlckluZm8nLFxuICAgICAgICBoYW5kbGVGZWVkYmFjazogJ2hhbmRsZUZlZWRiYWNrJyxcbiAgICAgICAgcm91dGVJbnRlbnQ6ICdyb3V0ZUludGVudCcsXG4gICAgICB9LFxuICAgIClcbiAgICAuYWRkRWRnZSgncmVjb3JkVXNlckluZm8nLCAncm91dGVJbnRlbnQnKVxuICAgIC5hZGRDb25kaXRpb25hbEVkZ2VzKFxuICAgICAgJ3JvdXRlSW50ZW50JyxcbiAgICAgIChzOiBHcmFwaFN0YXRlKSA9PiB7XG4gICAgICAgIGlmIChzLm1pc3NpbmdQcm9maWxlRmllbGQpIHtcbiAgICAgICAgICByZXR1cm4gJ2Fza1VzZXJJbmZvJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcy5pbnRlbnQgfHwgJ2dlbmVyYWwnO1xuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgYXNrVXNlckluZm86ICdhc2tVc2VySW5mbycsXG4gICAgICAgIGdlbmVyYWw6ICdyb3V0ZUdlbmVyYWwnLFxuICAgICAgICB2aWJlX2NoZWNrOiAndmliZUNoZWNrJyxcbiAgICAgICAgY29sb3JfYW5hbHlzaXM6ICdjb2xvckFuYWx5c2lzJyxcbiAgICAgICAgLy9zdHlsaW5nOiAncm91dGVTdHlsaW5nJyxcbiAgICAgICAgc3R5bGVfc3R1ZGlvOiAnaGFuZGxlU3R5bGVTdHVkaW8nLFxuICAgICAgfSxcbiAgICApXG4gICAgLmFkZEVkZ2UoJ3JvdXRlR2VuZXJhbCcsICdoYW5kbGVHZW5lcmFsJylcbiAgICAuYWRkQ29uZGl0aW9uYWxFZGdlcyhcbiAgICAgICdyb3V0ZVN0eWxpbmcnLFxuICAgICAgKHM6IEdyYXBoU3RhdGUpID0+IHtcbiAgICAgICAgLy8gUmVtb3ZlZCByZWR1bmRhbnQgZGVidWcgbG9nIGFzIHBlciByZXZpZXdcblxuICAgICAgICBpZiAocy5hc3Npc3RhbnRSZXBseSkge1xuICAgICAgICAgIHJldHVybiAnc2VuZFJlcGx5JztcbiAgICAgICAgfVxuICAgICAgICBpZiAocy5zdHlsaW5nSW50ZW50KSB7XG4gICAgICAgICAgcmV0dXJuICdoYW5kbGVTdHlsaW5nJztcbiAgICAgICAgfVxuICAgICAgICBsb2dnZXIud2Fybih7IHVzZXJJZDogcy51c2VyLmlkIH0sICdFeGl0aW5nIHN0eWxpbmcgZmxvdyB1bmV4cGVjdGVkbHksIHJvdXRpbmcgdG8gZ2VuZXJhbCcpO1xuICAgICAgICByZXR1cm4gJ3JvdXRlR2VuZXJhbCc7XG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBoYW5kbGVTdHlsaW5nOiAnaGFuZGxlU3R5bGluZycsXG4gICAgICAgIHJvdXRlR2VuZXJhbDogJ3JvdXRlR2VuZXJhbCcsXG4gICAgICAgIHNlbmRSZXBseTogJ3NlbmRSZXBseScsXG4gICAgICB9LFxuICAgIClcbiAgICAuYWRkRWRnZSgndmliZUNoZWNrJywgJ3NlbmRSZXBseScpXG4gICAgLmFkZEVkZ2UoJ2Fza1VzZXJJbmZvJywgJ3NlbmRSZXBseScpXG4gICAgLmFkZEVkZ2UoJ2hhbmRsZVN0eWxlU3R1ZGlvJywgJ3NlbmRSZXBseScpXG4gICAgLy8uYWRkRWRnZSgnaGFuZGxlU3R5bGluZycsICdzZW5kUmVwbHknKVxuICAgIC5hZGRFZGdlKCdjb2xvckFuYWx5c2lzJywgJ3NlbmRSZXBseScpXG4gICAgLmFkZEVkZ2UoJ2hhbmRsZUdlbmVyYWwnLCAnc2VuZFJlcGx5JylcbiAgICAuYWRkRWRnZSgnaGFuZGxlRmVlZGJhY2snLCAnc2VuZFJlcGx5JylcbiAgICAuYWRkRWRnZSgnc2VuZFJlcGx5JywgRU5EKTtcblxuICByZXR1cm4gZ3JhcGguY29tcGlsZSgpO1xufVxuIl19